# Step 9 — Does the plan fit the goal? (architecture fit analysis)

**Your goal (restated):** an MCP server that replicates the *minimum
functionality of the VS Code extension* and communicates with the *browser
extension* that drives chatbot websites.

**Short answer:** the current plan (Steps 1–7) is excellent, production-quality
engineering — but it implements the **wrong half** of the VS Code extension for
that goal. It makes the MCP server a **client** that *depends on the VS Code
extension still running*, instead of a **replacement** for it. One architectural
decision fixes this. Details below.

---

## 1. The actual CodeWebChat architecture (verified in source)

There are **three** runtime roles, not two:

| Role | Who plays it | Token | Connects how |
| --- | --- | --- | --- |
| **WebSocket server** (relay) | the **VS Code editor extension** spawns it | — | *hosts* `localhost:55155` |
| **Editor client** | the VS Code extension itself | `gemini-coder-vscode` | connects to 55155 |
| **Browser client** | the browser extension | `gemini-coder` | connects to 55155 |

Source: the server is hosted by the **editor** app, not a neutral process:

- `apps/editor/src/services/websocket-server-process.ts:20` — `class WebSocketServer`,
  `new WebSocket.Server(...)`, accepts both tokens, **relays** messages:
  `initialize-chat` (editor → browsers) at L143, `apply-chat-response`
  (browser → target editor) at L158, plus `client-id-assignment` and
  browser-connection-status notifications.
- `apps/browser/src/background/websocket.ts:61` — the browser extension is a
  plain client: `new WebSocket('ws://localhost:55155?token=gemini-coder...')`,
  with auto-reconnect and a `/health` poll.
- `packages/shared/src/constants/websocket.ts:2` — `DEFAULT_PORT = 55155`.

So the message path today is:

```
VS Code editor ──initialize-chat──▶ [WS server in editor] ──▶ browser ext ──▶ chatbot site
chatbot site ──▶ browser ext ──apply-chat-response──▶ [WS server in editor] ──▶ VS Code editor
```

**Key consequence:** whoever owns port **55155** is the editor extension. The
browser extension just connects to that port. Only one process can bind 55155 at
a time.

---

## 2. What "minimum functionality of the VS Code extension" actually is

Stripped to the browser bridge (ignoring file editing, the apply pipeline, the
UI), the editor extension's minimum job is:

1. **Host the WebSocket server** on 55155 (the relay).
2. Accept the browser client, track connect/disconnect.
3. Send **`initialize-chat`** (prompt + target URL + options) to the browser.
4. Receive **`apply-chat-response`** back.
5. (Today) the response *text* comes via the OS clipboard, not the message.

Item **1 is the part that makes it a "VS Code extension replacement."** Without
hosting the server, you are not replacing the extension — you are adding a second
editor next to it.

---

## 3. How the current plan maps onto this

Your Steps 1–7 build a **vscode-role _client_**:

> Step 2: *"connects to the existing CodeWebChat WebSocket server as a VS Code-role
> client … the fastest prototype path because CodeWebChat already supports
> multiple editor-role clients."*

That is the **client half**, items 3–5 above. It is correct and well-built, but
it **requires the VS Code extension to be running** to host the server (item 1).
So as written, the plan does **not** meet your stated goal — it rides on the very
extension you want to replace.

```
[ MCP server ] ──client──▶ [ WS server STILL hosted by VS Code editor ] ──▶ browser
                                         ▲ you still need VS Code running
```

This is great for a first prototype (least new code, reuses the real relay), but
it is a dependency, not a replacement.

---

## 4. The decision that makes the plan fit the goal

There are two modes. The plan currently assumes Mode A; your goal needs Mode B.

### Mode A — Client mode (what Steps 1–7 build)
MCP server connects to 55155 as an editor client. **VS Code must be running.**
- Pros: minimal code, reuses the real relay, validates the browser handshake fast.
- Cons: does not replace the extension; two editors on one server; can't run headless.

### Mode B — Host mode (what "replicate the extension" requires) ⭐
MCP server **hosts** the WebSocket server on 55155 itself (port the relay from
`apps/editor`), so the **browser extension connects directly to the MCP server**.
**No VS Code needed.**
- Pros: this *is* the replacement; works headless; the browser extension needs
  zero changes (it already just dials `localhost:55155`).
- Cons: more code (you own the server + relay + client lifecycle); you must not
  run it while the VS Code extension is bound to 55155 (port conflict).

```
Mode B:  [ browser ext ] ──client──▶ [ MCP server HOSTS 55155 + sends initialize-chat ]
                          ◀─apply-chat-response──
         (VS Code extension not involved at all)
```

**Recommendation:** keep Mode A as **Phase A** (validate the prompt→apply→clipboard
loop against the real, unmodified relay — fastest possible proof). Then add
**Phase B = Mode B** as the actual deliverable: lift the `WebSocketServer` class
from `apps/editor/src/services/websocket-server-process.ts` into the MCP server
so it owns 55155 and the browser talks to it directly. Most of your Step 2 client
code becomes the server's internal "editor side," so little is wasted.

---

## 5. Step-by-step fit verdict

| Step | What it builds | Fit with the goal | Action |
| --- | --- | --- | --- |
| 1 — package skeleton | package.json, protocol types, errors, clipboard | ✅ Reusable in both modes. Protocol types already match the real `@shared` constants/messages. | Keep. Add a `--mode host\|client` flag later. |
| 2 — WebSocket **bridge (client)** | connect as editor client, send `initialize-chat`, await `apply-chat-response`, clipboard guard, disconnect handling | ⚠️ Correct for Mode A only. For the goal you need the **server** side too. The serialization, clipboard guards, and disconnect logic all carry over. | Keep for Phase A; in Phase B wrap it with a hosted relay (port from `apps/editor`). |
| 3 — MCP tools (`cwc_status`, `send_to_codewebchat`) | tool surface | ✅ Tool surface is mode-agnostic. `cwc_status` should also report "am I hosting vs connected." | Keep; extend status fields for host mode. |
| 4 — client config + demo | Claude Desktop / Cursor config, manual demo | ✅ Fine. Note in the demo whether VS Code must be running (Mode A: yes; Mode B: no). | Keep; add a Mode-B demo with VS Code closed. |
| 5 — tests (mocked WS) | unit/integration | ✅ Mocking the WS boundary works for both modes. In host mode you'll also drive a fake *browser* client. | Keep; add host-mode tests. |
| 6 — protocol upgrade (v1) | `request_id`, response text in payload | ✅✅ Especially valuable in host mode — **you own the server**, so you can add `request_id` and inline response text *without the clipboard* on your side. This removes your most fragile dependency. | Prioritise once Mode B exists. |
| 7 — ADR | architecture decision record | ✅ This is exactly where the **Mode A vs Mode B** decision (and the blocking-call decision from `08-.../07`) must be recorded. | Add both decisions here. |

---

## 6. What the plan correctly leaves out (good)

The editor extension also does file editing, the diff/apply pipeline, context
gathering, and UI. Your Step 3 explicitly excludes the apply pipeline and returns
raw text only. That is the right minimum — none of it is needed to talk to the
browser. Don't add it.

---

## 7. The clipboard problem is smaller in Mode B

Today the response text isn't in `apply-chat-response`; you read the OS clipboard
(fragile: timing, permissions, "unchanged" guard). In **Mode B you host the
server**, so you control the protocol end-to-end. Combined with Step 6, you can
have the browser send the response text in the message (or add a `request_id` +
inline payload) and drop the clipboard path entirely — turning your single
biggest reliability risk into an internal detail. (This may need a small browser-
extension change; check `apps/browser` since it's in this same repo.)

---

## 8. Concrete next actions

1. **Record the Mode A vs Mode B decision in the ADR (Step 7).** Recommended:
   Phase A = client mode to validate fast; Phase B = host mode as the goal.
2. **Add a Phase B step** ("Step 2b — Host the WebSocket relay"): port
   `WebSocketServer` from `apps/editor/src/services/websocket-server-process.ts`,
   reusing your Step 2 editor-side logic as the server's internal sender.
3. **Add the `--mode` flag** to the package (Step 1) and a host-vs-client field to
   `cwc_status` (Step 3).
4. **Resolve the blocking-call design** (`08-.../07`) — it applies to both modes
   and sets the tool schema.
5. **Pull Step 6 (request_id + inline response) forward** for Mode B to kill the
   clipboard dependency.

---

### One-line summary

Steps 1–7 build a correct **editor _client_** that still needs VS Code; your goal
needs the MCP server to **host the relay** (Mode B) so the browser extension talks
to it directly. Keep everything you've built, frame it as Phase A, and add the
hosted-server phase — most of the client code is reused, not thrown away.
