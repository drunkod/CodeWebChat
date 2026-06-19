# Step 2b — Host the WebSocket relay (Phase B, the goal)

**Prerequisite:** the Phase A demo (Step 4) passes with VS Code running. Don't
start this until then.

**Goal:** make the MCP server *host* the WebSocket server on `localhost:55155`
itself, so the **browser extension connects directly to it** and **VS Code is not
needed at all**. This is the step that turns "an extra editor client" into "a
replacement for the editor extension."

This file is a **set of pointers**, not code to paste into the repo. It tells you
what to port, what to drop, and how to fold in your existing Step 2 logic.

> **Complete reference code** for everything below — the `CwcTransport` interface,
> `ClientTransport`, `HostTransport`, `PromptRunner`, the `--mode` flag, and
> host-mode tests — is in **`02c-host-mode-reference-code.md`**.

---

## What you're porting

Source of truth — the editor extension's relay:

- `apps/editor/src/services/websocket-server-process.ts`
  - `class WebSocketServer` (≈L20) — HTTP server + `ws` server
  - `_create_http_server` (≈L40) — CORS + `GET /health` (the browser polls this)
  - `_handle_connection` (≈L70) — token check (`gemini-coder` vs
    `gemini-coder-vscode`), splits browser vs editor clients
  - `_handle_browser_connection` (≈L97) — assigns a browser id, sends
    `{action:'connected', id}`, notifies editor clients
  - `_handle_message` (≈L139) — **the relay**: `initialize-chat` editor→browsers
    (L143), `apply-chat-response` browser→editor (L158)
  - `_ping_clients` (≈L226) — 10s keepalive ping

Shared constants you already mirror in `src/protocol.ts`:

- `packages/shared/src/constants/websocket.ts` — `DEFAULT_PORT = 55155`,
  `SECURITY_TOKENS`.

The browser side needs **no changes** — it already dials
`ws://localhost:55155?token=gemini-coder...` and auto-reconnects
(`apps/browser/src/background/websocket.ts:61`). When your server owns 55155, the
browser connects to you.

---

## What to keep vs. drop (minimum host)

In pure host mode **the MCP server *is* the editor**, so you can drop the parts of
the relay that exist only to serve *other* editor clients.

| Relay capability | Keep in MCP host? | Why |
| --- | --- | --- |
| HTTP server + `GET /health` | **Keep** | Browser polls `/health` to detect a live server before connecting. |
| Token validation | **Keep** | Reject anything that isn't `gemini-coder` (browser). You may also accept `gemini-coder-vscode` if you want real VS Code to still attach — optional. |
| Browser client registry (id, version, user_agent) | **Keep** | You need to target a browser and report status. |
| `connected` message + browser-connection-status notify | **Keep (simplify)** | Drives your `cwc_status`. You can notify *yourself* internally instead of broadcasting to editor clients. |
| `client-id-assignment` to editor clients | **Drop** | There is no separate editor client — you are it. |
| Editor↔editor relay / multi-editor maps | **Drop** | Single in-process "editor." |
| Ping/keepalive | **Keep** | Detect dead browser sockets fast. |

So the minimum host = HTTP `/health` + accept browser clients + send
`initialize-chat` to a browser + receive `apply-chat-response` + track
connect/disconnect + ping.

---

## How your Step 2 code is reused (not thrown away)

Your Step 2 `CwcBridge` already implements the **editor side** of the
conversation. In host mode the only thing that changes is the **transport
direction**:

- Mode A: `CwcBridge` is a *client* — it dials the server and the relay forwards
  `initialize-chat` to the browser.
- Mode B: the MCP server *is* the server — it sends `initialize-chat` **straight
  to the browser socket** it accepted; the browser sends `apply-chat-response`
  **straight back** to you.

Everything else in Step 2 carries over unchanged:

- per-request **serialization** (`active_request` queue),
- the **clipboard before/after guard** (`CWC_CLIPBOARD_EMPTY` /
  `CWC_CLIPBOARD_UNCHANGED`),
- **disconnect-while-in-flight** rejection (now: *browser* socket closes →
  reject in-flight with `CWC_DISCONNECTED`/a new `CWC_BROWSER_GONE`),
- the `timeout_ms` → `CWC_TIMEOUT` path.

Suggested shape: split the bridge into a transport interface with two
implementations so the tools (Step 3) don't care which mode is active:

```text
interface CwcTransport {
  ensureReady(): Promise<void>          // A: connect as client;  B: start server + await a browser
  status(): BridgeStatus                // add: mode, hosting, browser_count
  sendInitializeChat(msg): void         // A: ws.send to relay;   B: browserSocket.send
  onApplyResponse(cb): void             // A: from relay;         B: from browser socket
  onClose(cb): void
}
```

`sendPromptAndWait` stays identical — it just talks to a `CwcTransport`.

---

## New failure modes to plan for (host mode)

1. **Port 55155 already in use** — VS Code's extension (or a stale server
   process) owns it. Detect `EADDRINUSE` on listen and return a clear error:
   *"Port 55155 is in use — close the CodeWebChat VS Code extension, or run in
   client mode."* Add code `CWC_PORT_IN_USE`. This is the #1 host-mode footgun
   (A and B can't both bind the port).
2. **No browser connects** — you host fine but nobody dials in. `ensureReady`
   should wait up to a timeout then fail with `CWC_NO_BROWSER`.
3. **Browser disconnects mid-request** — reject in-flight (reuse the Step 2
   close-handler pattern).

---

## `cwc_status` additions (Step 3)

Report which mode you're in and what's connected:

```text
{ mode: 'host' | 'client',
  hosting: true,                 // host mode: are we bound to 55155?
  websocket_connected: true,     // client mode field, keep for parity
  browser_connected: true,
  connected_browser_count: 1 }
```

---

## Testing (extend Step 5)

You no longer mock "the server you connect to" — instead you **drive a fake
browser client** against your real hosted server:

1. Start the host server on an ephemeral port (inject the port, don't hardcode
   55155 in tests).
2. Open a `ws` client with token `gemini-coder` → assert it gets `connected`.
3. Call `send_to_codewebchat` → assert the fake browser receives
   `initialize-chat`.
4. Fake browser replies `apply-chat-response` (and, for Phase C, `response_text`)
   → assert the tool resolves.
5. Close the fake browser mid-request → assert fast rejection.
6. Bind the port twice → assert `CWC_PORT_IN_USE`.

---

## Step-by-step checklist for Phase B

```text
[ ] Add a --mode host|client flag (default: client) in Step 1's package/CLI.
[ ] Port the minimum WebSocketServer (HTTP /health + browser accept + relay) into
    src/cwc-host-server.ts — adapted, NOT importing apps/editor.
[ ] Implement CwcTransport with ClientTransport (Step 2) and HostTransport (new).
[ ] Route sendInitializeChat / onApplyResponse to the accepted browser socket.
[ ] Handle EADDRINUSE -> CWC_PORT_IN_USE; no-browser -> CWC_NO_BROWSER.
[ ] Extend cwc_status with mode/hosting/browser_count.
[ ] Add host-mode tests with a fake browser client on an ephemeral port.
[ ] Manual demo: CLOSE VS Code, start MCP server in host mode, connect the
    browser extension, run the Step 4 prompt -> confirm it returns text.
[ ] Record ADR-005 (Mode A vs B) in Step 7.
```

**Definition of done:** the Step 4 manual demo passes **with the VS Code
extension closed**. That is the moment the MCP server has replaced the editor
extension's browser-bridge role.

---

## Note on the clipboard (leads into Phase C / Step 6)

Once you own the server, you control the protocol. Phase C (Step 6) adds
`request_id` + `response_text` to `apply-chat-response` so the browser sends the
text directly and you delete the clipboard path entirely. That change lives in
`apps/browser` (same repo) — out of scope for this step, but host mode is the
prerequisite that makes it clean.
