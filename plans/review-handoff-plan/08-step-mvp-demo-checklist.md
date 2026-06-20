# Step 8 — MVP demo & acceptance checklist

The end-to-end proof that Review Handoff v0 works. Run the **manual dry-run first**
(8.1) to judge review quality before automating, then the full flow (8.2).

## 8.1 Manual dry-run (do this FIRST)

Goal: confirm the ChatGPT review is actually good before wiring anything.

```text
[ ] Build a packet.json by hand for a real recent commit (Step 3).
[ ] Fill the handoff prompt (Step 2/4).
[ ] In the Inspector (or directly in the ChatGPT project), paste the prompt.
[ ] Confirm: ChatGPT uses the connected GitHub repo, reviews the right commit,
    and returns verdict + findings + a valid JSON block.
[ ] Judge quality: are findings specific, path-accurate, and useful?
```

If the review is weak, tune the **reviewer system prompt** and **handoff prompt**
(`prompts/`) before continuing — cheaper now than after automation.

## 8.2 Full MVP flow (the demo)

```text
[ ] Step 1: cwc_status in Zed → mode:host, hosting:true, browser_connected:true.
[ ] AI edits code in Zed; commit to draft/<slug>; push.
[ ] Step 3: build-packet.sh → packet.json with the REMOTE commit_sha.
[ ] Step 2/4: fill-handoff.mjs → handoff-prompt.txt.
[ ] Step 4: send_to_codewebchat(url=ChatGPT project, text=prompt, prompt_type=edit-context) → ticket.
[ ] Click CodeWebChat Apply Response in the ChatGPT tab.
[ ] Step 4: poll_cwc_response → status:done with the review.
[ ] Step 5: parse-review.mjs → review.json (verdict/findings/tests/patch_plan).
[ ] Step 5: run the feedback-back prompt in Zed; apply fixes.
[ ] Step 6: commit again, run check-sha.sh → drift warning appears.
[ ] Step 7: disconnect the browser, retry → fallback prints the prompt + opens the page.
```

## 8.3 Acceptance criteria (matches the MVP story)

- The handoff packet contains repo, base, draft, commit SHA, title, summary,
  changed files, review focus. ✅
- The request is sent via the existing host-mode tools; the review returns into
  Zed. ✅
- The review separates blockers / non-blockers / suggested tests / patch plan
  (prose + JSON). ✅
- A commit-SHA match check warns on drift. ✅
- On transport failure, a copyable fallback payload is shown. ✅

## 8.4 What "done" unlocks

When 8.2 passes, Review Handoff v0 is real: Zed → GitHub-connected ChatGPT review
→ feedback into Zed, with no VS Code and no new server code. Next:

1. **Re-prioritize Phase C** (drop the clipboard) for clean review-text return.
2. Promote to **v1 dedicated tools** (`09-step-v1-dedicated-tools.md`).
3. Tune prompts and add review-focus presets as one-click options.
