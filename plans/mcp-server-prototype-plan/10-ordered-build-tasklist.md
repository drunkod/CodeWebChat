# Step 10 — Ordered build task list

One sequenced checklist that threads every plan file (`01`–`07`, `02b/02c`,
`03b`, `06b`, `08/`) into the order you actually build in. Work top to bottom.
**Decision gates** (◆) must be resolved before the tasks beneath them.
Phase letters match `00-START-HERE.md`.

> **Progress:** Phases 0, A, B **complete** — **core goal reached** (host mode
> demo passed with VS Code closed, 2026-06-20). Decision Gate 1 = Option C.
> Next: host-mode tests (T.3) and Phase C (drop the clipboard).

---

## Phase 0 — Scaffold  (plan: Step 1) ✅ DONE

- [x] **0.1** Create `apps/mcp-server/` package (`package.json`, `tsconfig.json`).
- [x] **0.2** Add `src/protocol.ts` (mirror `@shared` message types + tokens +
      `DEFAULT_CWC_PORT`), `src/errors.ts` (`CwcMcpError`), `src/clipboard.ts`.
- [x] **0.3** `pnpm install` + `pnpm --filter cwc-mcp-server build` from repo root;
      confirm `dist/index.js` exists.

*Exit:* package builds. ✅

---

## Phase A — Client mode end-to-end  (plan: Steps 2, 3, 4) ✅ DONE

- [x] **A.1** Build the client bridge `src/cwc-bridge.ts` (Step 2): connect as
      `gemini-coder-vscode`, await `client-id-assignment`, send `initialize-chat`,
      await `apply-chat-response`, clipboard before/after guard, **reject in-flight
      on `ws.on('close')`** (`CWC_DISCONNECTED`). *(now superseded by ClientTransport
      + RequestRegistry in B.1–B.3; file orphaned/removable.)*
- [x] **A.2** Register the two tools `src/index.ts` (Step 3): `cwc_status`,
      `send_to_codewebchat`.
- [x] **A.3** Wire MCP client config (Step 4): Claude Desktop / Cursor JSON,
      `npx @modelcontextprotocol/inspector`.
- [x] **A.4** ✅ **Checkpoint demo (VS Code OPEN):** prompt → browser opens →
      click Apply → tool returns clipboard text. *(Verified live against Gemini.)*

*Exit:* the Step 4 demo passes with the VS Code extension running. ✅

---

## ◆ Decision gate 1 — blocking-call design (ADR-009) ✅ DONE → Option C

- [x] **G1** Chose **Option C** (split `send`+`poll`). Recorded in ADR-009 (`07`).
      *(The Inspector's 60s "Maximum Total Timeout" during A.4 forced this.)*

- [x] **G1.1** Add `CWC_UNKNOWN_TICKET` to `errors.ts`.
- [x] **G1.2** Add `src/request-registry.ts` (`03b`); `require_request_id:false`.
- [x] **G1.3** Replace the single tool with `send_to_codewebchat` (returns ticket)
      + `poll_cwc_response` (`03b`). Re-ran the round-trip with the two-call flow.

---

## Phase B — Host mode (the goal)  (plan: 02b pointers, 02c code)

Depends on: Phase A green, Decision gate 1. ✅

- [x] **B.1** Add `src/transport.ts` — pure `CwcTransport` interface (`connect`,
      `ensureReady`, `sendInitializeChat`, `onApplyResponse`, `onClose`, `status`,
      `close`) + `BridgeStatus` with `mode` + `hosting`.
- [x] **B.2** Move the orchestration into `src/request-registry.ts`
      (`begin`/`poll` tickets + clipboard guard + `pending_apply` timeout +
      `clearTimeout`), talking to a `CwcTransport` instead of a raw socket.
- [x] **B.3** `src/client-transport.ts` — Mode A connect/handshake/browser-status
      as `CwcTransport`; `index.ts` rewired to `ClientTransport` + `RequestRegistry`;
      `server.test.ts` asserts `poll_cwc_response`. Build + 9 tests green.
      *(Recommended: rebuild in Nix + re-run the Inspector `send → Apply → poll`
      round-trip once to confirm the live regression.)*

- [x] **B.4** `src/host-transport.ts` — hosts the relay on 55155: HTTP `/health`,
      accepts `gemini-coder` browser clients, sends `initialize-chat` to the browser
      socket, receives `apply-chat-response`, app-level `{action:'ping'}` every 10s,
      browser disconnect → `CWC_BROWSER_GONE`.
- [x] **B.5** `EADDRINUSE` on listen → `CWC_PORT_IN_USE`; `boundPort()`/`address()`
      for ephemeral-port tests.
- [x] **B.6** `--mode host|client` flag + mode-aware instructions in `index.ts`;
      `cwc_status` reports `mode`/`hosting`/`connected_browser_count`.
- [x] **B.7** ✅ **Checkpoint demo (VS Code CLOSED) — PASSED 2026-06-20.**
      Host mode: `cwc_status` → `mode:host, hosting:true, browser connected`;
      `send` → ticket; `poll` → pending → **done** with the real Gemini reply.
      Browser stayed connected through the Apply wait (ping fix verified).

*Exit:* ✅ the demo passes with VS Code **closed** — the editor extension's
browser-bridge role is replaced. **Phase B complete; core goal reached.**

---

## Phase C — Remove the clipboard  (plan: Step 6, 06b)  ▢ not started

Depends on: Phase B (cleanest when you own the server).

- [ ] **C.1** Add optional `request_id` + `response_text` to
      `packages/shared/.../websocket-message.ts` and `src/protocol.ts` (both
      messages) (`06b §1`). *Backward compatible — both optional.*
- [ ] **C.2** Registry: generate `request_id`, match on it, prefer
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

- [x] **X.1** Tighten server `instructions`, boundary + first-512-chars
      self-contained (`08-.../01`). *(`src/instructions.ts` created.)*
- [ ] **X.2** Add tool `annotations` (`readOnlyHint` etc.) + strict schemas
      (`08-.../04`).
- [ ] **X.3** Add `redact()` and run clipboard output **and** error messages
      through it (`08-.../03`).
- [ ] **X.4** Stable error codes / closed union used in tests (`08-.../02`).
      *(Partial: `CwcMcpError` codes exist; not yet surfaced through tool results
      or asserted as a closed union.)*
- [ ] **X.5** Ship `cwc_doctor` (WS on 55155 + clipboard, each failure with a fix)
      (`08-.../11`).
- [ ] **X.6** Effects injection (WS factory + clock + clipboard) for tests
      (`08-.../05`). *(Partial: `read_clipboard` is injected into the registry;
      WS factory + clock not yet.)*
- [ ] **X.7** Hash-only audit log, try/catch-wrapped, gitignored (`08-.../06`).
- [ ] **X.8** Pin the MCP SDK version (`08-.../12`).

---

## Testing (continuous, from Phase A)  (plan: Step 5)

- [ ] **T.1** Unit: `redact()`, error codes, clipboard guards. *(Partial:
      `errors.test.ts` covers `CwcMcpError`/`toErrorText`; `redact()` + clipboard
      guards pending.)*
- [ ] **T.2** Integration: tool ↔ transport ↔ **fake** WebSocket (client mode).
      *(Have real-stdio integration in `server.test.ts`; a fake-WebSocket harness
      for deterministic apply/disconnect is still pending.)*
- [ ] **T.3** Host mode: drive a **fake browser** on an ephemeral port; assert
      `initialize-chat` received, apply resolves, disconnect rejects,
      double-bind → `CWC_PORT_IN_USE` (`02c §7`). *(needs B.4)*
- [ ] **T.4** Split mode: send-returns-fast, pending→done, unknown ticket,
      disconnect (`03b §4`). *(Partial: unknown-ticket asserted in `server.test.ts`.)*
- [ ] **T.5** Phase C: inline `response_text` (clipboard untouched) + back-compat
      fallback (`06b §5`). *(needs Phase C)*
- [x] **T.6** One stdio smoke test via the official `Client` + `StdioClientTransport`
      (`server.test.ts` — lists tools, validates args).

---

## ◆ Decision gate 2 — response capture (Phase C only)  ▢ not reached

- [ ] **G2** Option A (clipboard readback in the click — minimal, all chatbots) vs
      Option B (per-chatbot `get_response_text` DOM scrape — robust, incremental).
      *Recommended: ship A; add B per chatbot where DOM proves more reliable.*
      Record in ADR-007 (`07`).

---

## Decisions ledger (record in `07` ADR as you pass each gate)

| Gate | Decision | ADR | Status |
| --- | --- | --- | --- |
| G1 | Blocking call: A vs C | ADR-009 | ✅ Accepted — **C (split send+poll)** |
| — | Mode A → Mode B phasing | ADR-008 | ✅ Proposed — A validates, B ships |
| G2 | Response capture: A vs B | ADR-007 | ▢ open (Phase C) |

---

## The critical path (shortest route to the goal)

```
0.1→0.3  →  A.1→A.4 (demo, VS Code open)  →  G1  →  B.1→B.7 (demo, VS Code CLOSED ✅)  →  C.1→C.5
  ✅DONE           ✅ DONE                    ✅              ✅ DONE — GOAL REACHED            ⬅ next (▢)
            └ validate the handshake ┘            └──── replaced the extension ────┘      └ kill clipboard ┘
```

Hardening (X) and tests (T) run alongside; don't let them block the A.4 and B.7
checkpoints, which are the two moments that prove the prototype works.
