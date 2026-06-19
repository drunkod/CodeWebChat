# Step 10 — Ordered build task list

One sequenced checklist that threads every plan file (`01`–`07`, `02b/02c`,
`03b`, `06b`, `08/`) into the order you actually build in. Work top to bottom.
**Decision gates** (◆) must be resolved before the tasks beneath them.
Phase letters match `00-START-HERE.md`.

> Note: graphify's MCP tool was still serving a stale graph at the time of
> writing (the CLI rebuilt `graph.json` to 7326 nodes, but the running MCP
> server hadn't reloaded it). Restart the graphify MCP server to query the fresh
> CodeWebChat graph. File references below come from direct source reading and
> are current.

---

## Phase 0 — Scaffold  (plan: Step 1)

- [ ] **0.1** Create `apps/mcp-server/` package (`package.json`, `tsconfig.json`).
- [ ] **0.2** Add `src/protocol.ts` (mirror `@shared` message types + tokens +
      `DEFAULT_CWC_PORT`), `src/errors.ts` (`CwcMcpError`), `src/clipboard.ts`.
- [ ] **0.3** `pnpm install` + `pnpm --filter cwc-mcp-server build` from repo root;
      confirm `dist/index.js` exists.

*Exit:* package builds.

---

## Phase A — Client mode end-to-end  (plan: Steps 2, 3, 4) ◀ START HERE

- [ ] **A.1** Build the client bridge `src/cwc-bridge.ts` (Step 2): connect as
      `gemini-coder-vscode`, await `client-id-assignment`, send `initialize-chat`,
      await `apply-chat-response`, clipboard before/after guard, **reject in-flight
      on `ws.on('close')`** (`CWC_DISCONNECTED`).
- [ ] **A.2** Register the two tools `src/index.ts` (Step 3): `cwc_status`,
      `send_to_codewebchat` (single blocking call for now).
- [ ] **A.3** Wire MCP client config (Step 4): Claude Desktop / Cursor JSON,
      `npx @modelcontextprotocol/inspector`.
- [ ] **A.4** ✅ **Checkpoint demo (VS Code OPEN):** prompt → browser opens →
      click Apply → tool returns clipboard text. Tick the Step 4 checklist.

*Exit:* the Step 4 demo passes with the VS Code extension running.
**Do not start Phase B until A.4 is green.**

---

## ◆ Decision gate 1 — blocking-call design (ADR-009)

- [ ] **G1** Confirm your MCP client's per-request timeout, then choose:
      **Option A** (single blocking call, keep Step 2c `PromptRunner`) or
      **Option C** (split `send`+`poll`, `03b-split-send-poll-reference-code.md`).
      Record the choice + date in ADR-009 (`07`). *Recommended: C.*

If **C**, do the refactor now (it changes the tool surface):

- [ ] **G1.1** Add `CWC_UNKNOWN_TICKET` to `errors.ts`.
- [ ] **G1.2** Add `src/request-registry.ts` (`03b`); keep `require_request_id:false`.
- [ ] **G1.3** Replace the single tool with `send_to_codewebchat` (returns ticket)
      + `poll_cwc_response` (`03b`). Re-run the A.4 demo with the two-call flow.

---

## Phase B — Host mode (the goal)  (plan: 02b pointers, 02c code)

Depends on: Phase A green, Decision gate 1.

- [ ] **B.1** Add `src/transport.ts` — `CwcTransport` interface + `BridgeStatus`
      (`mode`, `hosting`, …) + `sleep` (`02c §2`).
- [ ] **B.2** Refactor the shared orchestration: move Step 2/A.1 logic into
      `PromptRunner` **or** `RequestRegistry` (whichever G1 chose) so it talks to a
      `CwcTransport`, not a raw socket (`02c §3` / `03b §2`).
- [ ] **B.3** `src/client-transport.ts` — reshape A.1 bridge to `CwcTransport`
      (`02c §4`). **Regression-check: A.4 demo still passes.**
- [ ] **B.4** `src/host-transport.ts` — host the relay on 55155 (`02c §5`): HTTP
      `/health`, accept `gemini-coder` browser clients, send `initialize-chat` to
      the browser socket, receive `apply-chat-response`, ping, browser
      connect/disconnect → `CWC_BROWSER_GONE`. Port the minimum from
      `apps/editor/src/services/websocket-server-process.ts` (do **not** import it).
- [ ] **B.5** Handle `EADDRINUSE` on listen → `CWC_PORT_IN_USE`; add an
      `address()` getter for tests.
- [ ] **B.6** `--mode host|client` flag + mode-aware instructions in `index.ts`
      (`02c §6`); extend `cwc_status` with `mode`/`hosting`/`browser_count`.
- [ ] **B.7** ✅ **Checkpoint demo (VS Code CLOSED):** start `--mode host`,
      connect the browser extension, run a prompt → tool returns text.

*Exit:* the demo passes with VS Code **closed** — the editor extension's
browser-bridge role is replaced.

---

## Phase C — Remove the clipboard  (plan: Step 6, 06b)

Depends on: Phase B (cleanest when you own the server).

- [ ] **C.1** Add optional `request_id` + `response_text` to
      `packages/shared/.../websocket-message.ts` and `src/protocol.ts` (both
      messages) (`06b §1`). *Backward compatible — both optional.*
- [ ] **C.2** Runner/registry: generate `request_id`, match on it, prefer
      `response_text`, keep clipboard fallback (`06b §2`).
- [ ] **C.3 — browser change** (`06b §3`): thread `request_id` storage→observer→
      button (`message-handler.ts`, `send-prompt-content-script.ts`, each chatbot's
      `setup_observer`, `add-apply-response-button.ts`); read clipboard in the click
      → `response_text`; forward both fields in `message-handler.ts`. Add the two
      fields to `apps/browser/src/types/messages.ts`.
- [ ] **C.4** Flip `require_request_id: true` (safe concurrency) if on Option C.
- [ ] **C.5** ✅ **Checkpoint:** put junk on the OS clipboard, run a prompt, click
      Apply → tool returns the chatbot reply, not the junk.
- [ ] **C.6** Cleanup once stable: delete clipboard read, `clipboardy` dep, and the
      two clipboard error codes.

*Exit:* OS clipboard is out of the response path.

---

## Phase X — Hardening (cross-cutting)  (plan: `08-adapt-from-repo-harness/`)

Can start during Phase A; finish before you call it shippable. Build order from
`08-.../00-README.md`:

- [ ] **X.1** Tighten server `instructions`, boundary + first-512-chars
      self-contained (`08-.../01`).
- [ ] **X.2** Add tool `annotations` (`readOnlyHint` etc.) + strict schemas
      (`08-.../04`).
- [ ] **X.3** Add `redact()` and run clipboard output **and** error messages
      through it (`08-.../03`).
- [ ] **X.4** Stable error codes / closed union used in tests (`08-.../02`).
- [ ] **X.5** Ship `cwc_doctor` (WS on 55155 + clipboard, each failure with a fix)
      (`08-.../11`).
- [ ] **X.6** Effects injection (WS factory + clock + clipboard) for tests
      (`08-.../05`).
- [ ] **X.7** Hash-only audit log, try/catch-wrapped, gitignored (`08-.../06`).
- [ ] **X.8** Pin the MCP SDK version (`08-.../12`).

---

## Testing (continuous, from Phase A)  (plan: Step 5)

- [ ] **T.1** Unit: `redact()`, error codes, clipboard guards.
- [ ] **T.2** Integration: tool ↔ transport ↔ **fake** WebSocket (client mode).
- [ ] **T.3** Host mode: drive a **fake browser** on an ephemeral port; assert
      `initialize-chat` received, apply resolves, disconnect rejects,
      double-bind → `CWC_PORT_IN_USE` (`02c §7`).
- [ ] **T.4** Split mode: send-returns-fast, pending→done, unknown ticket,
      disconnect (`03b §4`).
- [ ] **T.5** Phase C: inline `response_text` (clipboard untouched) + back-compat
      fallback (`06b §5`).
- [ ] **T.6** One stdio smoke test via the official `StdioClientTransport`.

---

## ◆ Decision gate 2 — response capture (Phase C only)

- [ ] **G2** Option A (clipboard readback in the click — minimal, all chatbots) vs
      Option B (per-chatbot `get_response_text` DOM scrape — robust, incremental).
      *Recommended: ship A; add B per chatbot where DOM proves more reliable.*
      Record in ADR-007 (`07`).

---

## Decisions ledger (record in `07` ADR as you pass each gate)

| Gate | Decision | ADR | Default/recommended |
| --- | --- | --- | --- |
| G1 | Blocking call: A vs C | ADR-009 | C (split send+poll) |
| — | Mode A → Mode B phasing | ADR-008 | A validates, B ships |
| G2 | Response capture: A vs B | ADR-007 | A now, B per chatbot |

---

## The critical path (shortest route to the goal)

```
0.1→0.3  →  A.1→A.4 (demo, VS Code open)  →  G1  →  B.1→B.7 (demo, VS Code closed)  →  C.1→C.5
            └ validate the handshake ┘            └ replace the extension ┘          └ kill clipboard ┘
```

Hardening (X) and tests (T) run alongside; don't let them block the A.4 and B.7
checkpoints, which are the two moments that prove the prototype works.
