# START HERE — phased roadmap & where to begin

This is the entry point for the plan. Read this first. It tells you the order to
build in and — importantly — **where to start so you de-risk the hard part
cheaply**.

## The one idea

Your goal is **Mode B (host mode)**: the MCP server _hosts_ the WebSocket relay
on `localhost:55155` so the browser extension talks to it directly, with no VS
Code. (Why: see `09-fit-analysis-vs-goal.md`.)

But **do not start by writing host mode.** Start by validating the browser
handshake in **Mode A (client mode)**, which you've already planned (Steps 1–4).
That proves the message shapes and the prompt→Apply→clipboard loop are correct
against the _real, unmodified_ relay before you take on owning the server. If
Mode A doesn't work, Mode B won't either — and Mode A is far less code to debug.

## Phases (build in this order)

| Phase         | What                                         | Plan files                    | Needs VS Code running? | Exit criteria                                                                                        |
| ------------- | -------------------------------------------- | ----------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| **0**         | Scaffold the package                         | Step 1                        | n/a                    | `dist/index.js` builds; `cwc_status` callable                                                        |
| **A** ◀ start | Client mode end-to-end                       | Steps 2, 3, 4                 | **Yes**                | Manual demo green: prompt → browser opens → click Apply → tool returns text                          |
| **B** ⭐ goal | Host mode (own the relay)                    | **Step 2b** (new)             | **No**                 | Same demo passes with **VS Code closed**; browser connects to your server                            |
| **C**         | Add inline reply option (clipboard retained) | Step 6                        | No                     | `apply-chat-response` _also_ carries `response_text` + `request_id`; clipboard path KEPT as fallback |
| **X**         | Hardening (cross-cutting)                    | `08-adapt-from-repo-harness/` | —                      | instructions, redaction, doctor, error codes, blocking decision in place                             |
| **D**         | Decisions recorded                           | Step 7 ADR (+ ADR-005)        | —                      | Mode A/B and blocking-call decisions written down                                                    |

Tests (Step 5) run continuously from Phase A onward, not as a separate phase.

## Where to start — your first three actions

1. **Build Phase 0/A as written.** Follow Step 1 (package), then Steps 2–3
   (client bridge + the two tools). Nothing new to design here — it's already
   specced.
2. **Run the Step 4 manual demo with the VS Code extension running.** This is the
   real checkpoint. You're proving: token `gemini-coder-vscode` is accepted, you
   get a `client_id`, `initialize-chat` reaches the browser, the chatbot opens,
   and after you click Apply the tool returns clipboard text. Tick the Step 4
   demo checklist.
3. **Only once that loop is green, open `02b-step-host-websocket-relay.md`** and
   start Phase B. Most of your Step 2 client code is reused as the server's
   internal "editor side," so you're extending, not rewriting.

> Rule of thumb: don't write a line of host-mode code until the Mode A demo
> passes. The handshake you validate in Phase A is exactly the handshake your
> hosted server must reproduce in Phase B.

## Decisions to lock before Phase B (record in Step 7 ADR)

- **ADR-005: Mode A vs Mode B.** Recommended: ship A as a validation harness, B
  as the deliverable. (Draft entry appended to Step 7.)
- **Blocking-call design** (`08-adapt-from-repo-harness/07-...`). Decide
  _block-with-timeout_ vs _split send+poll_ before finalizing the tool schema —
  it changes inputs and error codes in both modes.

## Map of all plan files

- `00-START-HERE.md` — this file
- `01-step-create-mcp-package.md` — Phase 0 scaffold
- `02-step-build-codewebchat-websocket-bridge.md` — Phase A client bridge
- `02b-step-host-websocket-relay.md` — **Phase B host mode: pointers (new)**
- `02c-host-mode-reference-code.md` — **Phase B host mode: complete code (new)**
- `03-step-register-mcp-tools.md` — tools (both modes)
- `03b-split-send-poll-reference-code.md` — **split send+poll tools, ADR-009 Option C (new)**
- `04-step-add-client-config-and-demo.md` — Phase A demo
- `05-step-add-tests-with-mocked-websocket.md` — tests (ongoing)
- `06-step-upgrade-protocol-for-v1.md` — Phase C (add inline reply option; clipboard retained)
- `06b-phase-c-reference-code.md` — **Phase C: complete code incl. browser change (new)**
- `07-step-architect-decision-record.md` — ADR (add ADR-005)
- `08-adapt-from-repo-harness/` — Phase X hardening (instructions, redaction,
  audit, doctor, blocking design, etc.)
- `09-fit-analysis-vs-goal.md` — why Mode B is the goal (read for the rationale)
- `10-ordered-build-tasklist.md` — **the sequenced checklist threading every step (new)**
