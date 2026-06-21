# Review Handoff plan — START HERE

The step-by-step build of **Review Handoff v0 (MVP)**: in Zed, after the AI
finishes, one flow sends a structured review request to a GitHub-connected ChatGPT
page and brings the review back into Zed — using the **existing host-mode
`cwc-mcp-server`** (no new server code for the MVP).

Product framing, stories, and roadmap live in `docs/zed-review-handoff/`. This
folder is the executable plan.

## The one idea

Your host-mode MCP server already does "send a prompt to a browser chatbot → get
the reply." The ChatGPT review page is just another chatbot target. So the MVP is
**orchestration + prompts**, not transport:

```
Zed AI finishes → commit to draft branch → gather packet (repo/branch/SHA/files)
→ fill handoff prompt → send_to_codewebchat(ChatGPT page) → poll_cwc_response
→ review returns into Zed → apply fixes (feedback prompt) → optional re-review
```

## Decision (locked): phased

- **MVP (now) = prompt-driven, zero new tools.** Zed's agent gathers git metadata
  and calls the existing `send_to_codewebchat`. ← this plan.
- **v1 = thin `prepare_review_handoff` MCP tool.** Server-side metadata + dedicated
  review tools. Tracked at the end (`09-...`).

## Steps (build top to bottom)

| Step | File                                                                     | What                                                                              |
| ---- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Pre  | depends on                                                               | host-mode server built + browser extension + GitHub-connected ChatGPT project     |
| 1    | [`01-step-register-server-in-zed.md`](01-step-register-server-in-zed.md) | Register `cwc-mcp-server --mode host` in Zed; confirm tools                       |
| 2    | [`02-step-prompt-pack.md`](02-step-prompt-pack.md)                       | The 4 templates + the fill helper                                                 |
| 3    | [`03-step-gather-handoff-packet.md`](03-step-gather-handoff-packet.md)   | Collect repo/branch/SHA/files into a packet (git)                                 |
| 4    | [`04-step-send-review-request.md`](04-step-send-review-request.md)       | Fill prompt + `send_to_codewebchat` + `poll_cwc_response`                         |
| 5    | [`05-step-import-review-into-zed.md`](05-step-import-review-into-zed.md) | Parse verdict/findings/JSON; drive the fix pass                                   |
| 6    | [`06-step-sha-match-safety.md`](06-step-sha-match-safety.md)             | Refuse/warn if branch HEAD drifted from the reviewed SHA                          |
| 7    | [`07-step-fallback.md`](07-step-fallback.md)                             | Manual-copy fallback when transport fails                                         |
| 8    | [`08-step-mvp-demo-checklist.md`](08-step-mvp-demo-checklist.md)         | End-to-end acceptance demo                                                        |
| v1   | [`09-step-v1-dedicated-tools.md`](09-step-v1-dedicated-tools.md)         | Promote to `prepare_review_handoff` / `request_review` / `import_review_feedback` |

## Where to start

Do **Step 1** (wire the server into Zed) and confirm the agent can call
`cwc_status`. Then run **Step 8's manual dry-run once** before automating — it
proves the ChatGPT review quality before you invest in the flow.

## How this relates to the other plan

`plans/mcp-server-prototype-plan/` (Phases 0/A/B done, T.3 done) is the
foundation. Re-prioritization: add an **inline `response_text` reply option**
(reframed "Phase C") so long structured review replies can return intact — **as an
addition; clipboard support is retained** as a first-class path, not removed
(Step 5 notes where the inline option plugs in).
