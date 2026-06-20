# Zed → ChatGPT Review Handoff — overview & user stories

## What this product actually is

Not "another chat UI." It's a **review handoff layer**: after an AI editing
session finishes in your editor (Zed), the app packages the change (repo, branch,
commit SHA, summary, changed files), sends a structured review request to a
**GitHub-connected ChatGPT workspace**, and brings the structured feedback back
into the editor for the next fix pass.

(Direction and supporting research: `deep-research-report-5.md`.)

## Why we're already most of the way there

The convergence with what we've built is the important insight:

- **Transport already exists.** The `cwc-mcp-server` (host mode, Phase B — done)
  hosts the WebSocket relay itself and sends a prompt to a browser chatbot, then
  returns its reply. The ChatGPT review page *is* a browser chatbot. So
  "send a review request → get the review back" is the `send_to_codewebchat` /
  `poll_cwc_response` loop we already shipped.
- **No editor lock-in.** Because host mode removed the VS Code dependency, the
  exact same server works for **Zed** — Zed natively supports MCP servers, so
  Zed's agent can call our tools directly.
- **Editor building blocks already exist** in `apps/editor` (reusable logic, even
  if we re-home it): git repo detection (`utils/git-repository-utils.ts`),
  commit-message prompts (`utils/prompts-for-commit-messages-utils.ts`),
  commit/unstaged file sources (`commands/apply-context-command/sources/*`),
  instruction templates (`constants/instructions.ts`), and chatbot presets
  (`packages/shared/src/constants/chatbots.ts`, incl. a ChatGPT integration).

So the new work is the **orchestration + prompt layer**, not new transport.

## The architecture for your exact loop

```text
Zed AI finishes editing
  → commit changes to a draft branch (Zed Git, or our helper)
  → app captures: repo, base branch, draft branch, commit SHA, title, summary, changed files, review focus
  → app builds a handoff prompt and sends it to the ChatGPT page (host-mode MCP → browser)
  → ChatGPT uses its connected GitHub repo to inspect that commit/branch
  → ChatGPT returns a structured review (prose + JSON)
  → app surfaces the review back into Zed (agent thread / patch plan)
  → developer or AI applies fixes → optional second review pass
```

Every arrow except the two new orchestration steps is already built.

---

## User stories

### ⭐ MVP story (your minimal story, formalized)

> **As a developer using Zed with an AI editor, when the AI finishes a change, I
> want the app to commit it to a draft branch, send the commit SHA + summary to my
> GitHub-connected ChatGPT page as a review request, and bring the review back
> into Zed — so I can iterate on feedback without manually copying context between
> two windows.**

**Acceptance (MVP):**
- The handoff packet contains: `repo`, `base_branch`, `draft_branch`,
  `commit_sha`, `commit_title`, `summary`, `changed_files`, `review_focus`.
- The request is sent to the ChatGPT page via the existing host-mode tools.
- The review comes back as text (and, when asked, a JSON block) into Zed.
- A commit-SHA match check exists so feedback isn't applied to drifted code.
- If the automated handoff fails, a copyable fallback payload is shown.

### Supporting stories (bound the MVP sharply)

1. **Draft review handoff** — capture final draft changes into a review branch and
   send branch + commit metadata, so I get a second opinion without rebuilding
   context. *Accept:* the packet carries repo/base/draft/SHA/files/summary/mode.
2. **Handoff without brittle copy-paste** — the review page opens with the right
   context automatically. *Accept:* on failure, a manual-copy fallback payload.
3. **Feedback import back into Zed** — the review returns as an editor-friendly
   fix packet (blockers / non-blockers / suggested tests / smallest-patch plan).
4. **Review mode selection** — choose intent before sending (bug risk,
   architecture, test adequacy, merge readiness); the reviewer prompt adapts.
   *Accept:* a `review_focus` field changes the prompt.
5. **Safe iteration loop** — each round is traceable to a commit/branch state;
   refuse to apply feedback if branch HEAD no longer matches the reviewed SHA.
6. **In-editor fallback review** — if the browser flow is down, open the branch
   diff in a local agent review thread instead, so I'm never blocked.

### Extra use cases worth imagining (reusing existing CodeWebChat functionality)

These reuse code that already exists in `apps/editor` / `apps/browser` and the
chatbot integrations — they're "free-ish" because the primitives are built:

- **Auto commit-message draft.** Before the handoff, generate a commit title +
  summary from the diff using the existing `prompts-for-commit-messages-utils.ts`
  logic — so the "summary" field is filled for you.
- **Context-rich review.** Attach the changed-file set via the existing
  `commit-files-source` / `unstaged-files-source` so the prompt names exact paths
  (the reviewer prompt already wants exact paths).
- **"Smart finish" trigger.** A prompt/skill that fires when the AI editor
  finishes (your "use prompts when the AI editor finishes" idea) → auto-builds the
  handoff and calls `send_to_codewebchat`. Start as a manual command; later a
  real on-finish hook.
- **Multi-reviewer fan-out.** Because the browser bridge supports many chatbots
  (Claude, Gemini, ChatGPT all have integrations), send the same review request to
  two reviewers and compare verdicts. (Universal-phase.)
- **Reviewer presets.** Reuse the editor's "presets/Configurations" concept to
  save review modes (bug-risk vs architecture vs tests) as one-click presets.
- **Round-trip patch plan.** Turn the reviewer's JSON `editor_patch_plan` into a
  Zed agent task list, so fixes are queued, not retyped.

---

## Where clipboard fits (your open question)

Short answer: **clipboard is the current *return* path, not the core design — keep
it for the MVP, plan to remove it.**

- The review *request* goes out as a structured prompt (no clipboard).
- The review *reply* currently comes back when you click CodeWebChat **Apply
  Response**, which copies the chatbot text to the OS clipboard and the MCP server
  returns it. That's fine for the MVP.
- **Phase C** (`request_id` + inline `response_text`) removes the clipboard from
  the return path entirely. For the review use case — where the reply is long,
  structured text you want intact — Phase C is now *more* valuable, so it moves up
  the priority list. The research's "don't make clipboard the core dependency"
  lands exactly here: it's a convenience/fallback, not the architecture.

So: clipboard = useful now, removed by Phase C. Not a reason to redesign.

---

## Reviewer prompt pack (from the research — reuse verbatim)

Three prompts to template (full text in `deep-research-report-5.md`):

1. **Reviewer system prompt** — stable instruction for the ChatGPT-side reviewer
   (verdict / risk / findings / file comments / fixes / patch plan).
2. **Handoff prompt** — anchored to `{{repo}}/{{base}}/{{draft}}/{{commit_sha}}`,
   keeps the diff out of the message and points the GitHub-connected reviewer to
   the exact commit.
3. **Feedback-back prompt** — turns the review into an editor remediation prompt
   (fix blockers first, smallest coherent patch, summarize what changed).
4. **Machine-readable JSON variant** — `{verdict, risk, findings[], tests[],
   editor_patch_plan[]}` so import-back-to-Zed is mechanical.

These become our `instructions` / tool descriptions in the next plan doc.
