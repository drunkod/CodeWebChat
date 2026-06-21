# Review Handoff — MVP plan, roadmap, and how it changes our existing plans

Companion to `00-overview-and-user-stories.md`. This is the build plan: a lean
MVP that does _exactly_ your story, then a universal phase.

## Guiding principle

We already built the hard part (host-mode MCP transport). The MVP should add the
**smallest orchestration layer** that makes the review loop work, and lean on
existing pieces (Zed's Git + agent, the editor's git/commit utilities, the
chatbot integrations). Don't build a "mini editor" — build the handoff.

---

## MVP — "Review Handoff v0" (does your story, minimal)

Goal: in Zed, after the AI finishes, one command sends a structured review
request to the ChatGPT page and returns the review into Zed.

The big realization: **the MVP may need almost no new server code.** Zed supports
MCP, so Zed's agent can call the _existing_ `send_to_codewebchat` / `poll_cwc_response`
with a handoff prompt it builds from a template. So MVP = wiring + prompt pack +
a thin "prepare" helper.

### MVP scope

| Step | What                                                                                                                                                                                                                       | Reuses                                                                                      | New                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------ |
| M1   | Run `cwc-mcp-server --mode host`; register it as an MCP server in Zed (`settings.json` → context servers).                                                                                                                 | host-mode server (done)                                                                     | Zed config + a short setup doc |
| M2   | Prompt pack: reviewer system prompt, handoff prompt, feedback-back prompt, JSON variant — as reusable templates.                                                                                                           | research prompts                                                                            | `docs/.../prompts/*.md`        |
| M3   | "Prepare handoff" helper that fills the packet (`repo, base, draft, commit_sha, title, summary, changed_files, review_focus`). MVP: Zed's agent gathers it via its Git tools, OR a tiny `prepare_review_handoff` MCP tool. | `git-repository-utils.ts`, `commit-files-source.ts`, `prompts-for-commit-messages-utils.ts` | thin tool/skill                |
| M4   | Send: agent calls `send_to_codewebchat` with the built prompt + `url: https://chatgpt.com/...` (the project page) → `poll_cwc_response` until done.                                                                        | existing tools                                                                              | nothing                        |
| M5   | Return: the review text lands in the Zed agent thread; if JSON requested, the agent parses verdict/findings.                                                                                                               | existing return path (clipboard for now)                                                    | parse helper                   |
| M6   | Safety: SHA-match check — record the reviewed `commit_sha`; warn if branch HEAD moved before applying feedback.                                                                                                            | —                                                                                           | small check                    |
| M7   | Fallback: if send/poll fails, print the copyable handoff payload.                                                                                                                                                          | error codes                                                                                 | message                        |

### MVP acceptance (the demo)

1. AI edits code in Zed → you commit to a `draft/...` branch.
2. Run the "Send for review" command → ChatGPT page (GitHub-connected) opens/fills
   with the handoff prompt anchored to the commit SHA.
3. ChatGPT reviews the commit and replies; you Apply → the review returns into Zed.
4. The review separates blockers / non-blockers / suggested tests / patch plan.
5. If you've committed again since, the app warns the review may be stale.

### What the MVP deliberately defers

Auto-applying patches from the reply; bidirectional session sync; a custom Zed
panel/webview (Zed's extension model doesn't offer arbitrary webviews — MCP is the
supported surface); multi-reviewer fan-out; full ACP agent.

---

## How this changes our existing plans

The `plans/mcp-server-prototype-plan/` work stays valid — it's the foundation —
with these adjustments:

1. **Re-prioritize Phase C (add the inline reply option; clipboard retained).** For
   review replies (long, structured), inline `response_text` matters more than for
   short prompts. Move Phase C up: it's the cleanest return path for reviews — added
   _alongside_ the retained clipboard fallback, not as a replacement. (Plan: `06b`.)
2. **Target chatbot = ChatGPT.** Default `url` to the user's ChatGPT _project_
   page (GitHub-connected), not a fresh chat. Confirm `apps/browser`'s ChatGPT
   integration (`chatbots/chatgpt.ts`) injects the prompt into the project page
   correctly. `prompt_type: 'edit-context'` already triggers the Apply button.
3. **Add a new plan track: `plans/review-handoff-plan/`** for M1–M7 above, layered
   on top of the existing server. The existing `00-START-HERE` critical path
   (Phases 0/A/B done) feeds directly into M1.
4. **Phase X hardening still applies** — `redact()` is now important because review
   replies may quote secrets from the repo; the audit log should record review
   requests (hashed). Keep these.
5. **Reframe the product's "north star"** in the plan: from "MCP server that talks
   to chatbots" → "**review handoff layer** between an editor and a GitHub-connected
   reviewer." The server is the transport; the handoff is the product.

No throwaway work — the host-mode server, split send/poll, and tests are all the
substrate this rides on.

---

## Universal phase — "Review Handoff v1" (after the MVP works)

Once the loop is reliable, generalize:

- **Dedicated MCP tools** (so any MCP client, not just a hand-built prompt):
  - `prepare_review_handoff(review_focus)` → returns the filled packet + the built
    prompt (gathers git metadata server-side).
  - `request_review(packet)` → sends + returns a ticket (wraps begin/poll).
  - `import_review_feedback(ticket)` → returns the parsed JSON review
    (verdict/findings/tests/patch_plan).
- **Git automation:** auto-create the `draft/...` branch, commit with an
  AI-generated message (reuse `prompts-for-commit-messages-utils.ts`), push, and
  resolve the _remote_ HEAD SHA (the research's top finding: confirm push before
  reviewing stale code).
- **Review-mode presets** (bug-risk / architecture / tests / merge-readiness) as
  structured tool input, reusing the editor "Configurations/presets" concept.
- **Editor-agnostic:** the same server already works for Zed, VS Code, Cursor —
  document each client's MCP config.
- **Multi-reviewer fan-out & compare** (Claude + Gemini + ChatGPT) using the
  existing multi-chatbot integrations.
- **Phase C complete** → inline `response_text` available as the preferred return
  path, with the clipboard retained as a fallback.
- **Round-trip to a Zed task list** from `editor_patch_plan`.

---

## ✅ Decision (locked 2026-06-20): phased MVP

- **MVP (now) = prompt-driven, zero new tools (option 1).** Register the host-mode
  server in Zed; Zed's agent gathers git metadata with its own Git tools and calls
  the existing `send_to_codewebchat` with a handoff prompt from our template.
  Concrete steps in `02-zed-mvp-setup.md`; prompts in `prompts/`.
- **v1 = thin `prepare_review_handoff` MCP tool (option 2).** Once the loop is
  proven, move git-metadata gathering server-side (reuse the editor's git utils)
  and add `request_review` / `import_review_feedback`. Tracked in the Universal
  phase below.

## Other decisions to confirm

2. **ChatGPT target page:** a persistent ChatGPT _project_ URL with the repo
   connected (so each review reuses the connected GitHub context). Confirm the URL
   shape and that the browser integration fills it.
3. **Return format:** ask the reviewer for prose **plus** the JSON block from the
   start, so import-back is mechanical even in the MVP.
4. **Branch convention:** `draft/<task-slug>` or `review/<sha-short>`? Pick one for
   the SHA-match safety check.
5. **Trigger:** manual command for the MVP; "on AI finish" hook is a v1 nicety.

---

## Immediate next steps

1. Commit the current host-mode checkpoint (Phases 0/A/B + T.3) — it's the base.
2. Create `plans/review-handoff-plan/` with M1–M7 as concrete steps.
3. Write the three prompt templates into
   `docs/zed-review-handoff/prompts/` (reviewer, handoff, feedback + JSON).
4. M1: register `cwc-mcp-server --mode host` in Zed and confirm the agent can call
   `cwc_status` + `send_to_codewebchat`.
5. M4 dry run: hand-build a handoff prompt, send to the ChatGPT project page, and
   confirm the review returns into Zed. That's the MVP heartbeat.

Answer the 5 decisions above and we'll turn M1–M7 into a step-by-step plan exactly
like the `mcp-server-prototype-plan`.
