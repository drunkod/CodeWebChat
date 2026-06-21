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

## 8.1b — ⚠️ Is the reviewer actually GROUNDED? (run every time)

The transport can succeed while the review is **worthless** — if the ChatGPT page
can't see the commit, it will "review" by guessing from the commit title and file
names. A guessed review reads plausibly but is hedged and generic. Catch it:

**Preconditions (before sending):**

```text
[ ] The branch/commit is PUSHED to GitHub:  git push -u origin <draft_branch>
    (you've been committing locally with --no-verify — push, or the reviewer
     has nothing to fetch.)
[ ] packet.json commit_sha is the REMOTE head (run build-packet.sh WITHOUT
    CWC_NO_PUSH=1, so it pushes and reads origin/<branch>).
[ ] The `url` you send to is the GitHub-CONNECTED ChatGPT project — not a plain
    chatgpt.com/ chat. Open it and confirm the repo connector is attached.
```

**Grounding test (on the returned review) — RED FLAGS that mean "not grounded":**

```text
[ ] The reply does NOT start with disclaimers like "I can't directly fetch the
    diff" / "based on the commit intent" / "this pattern typically".
[ ] Findings cite REAL code: concrete identifiers, line-ish references, exact
    symbols actually in the changed files (e.g. `server.listen(this.port)`,
    `sendInitializeChat broadcasts`) — not hedged "likely/probably/if it assumes".
[ ] Paths in findings match the ACTUAL changed_files in packet.json.
[ ] At least one finding could only be known by reading the file, not the title.
```

If any RED FLAG trips: the reviewer is guessing. **Fix the preconditions
(push + connected project URL) and re-run — do not act on a guessed review.**

> Worked example: a grounded review of the host transport cited the real
> `server.listen(this.port)` loopback bug and the `sendInitializeChat` broadcast.
> A non-grounded run of the _same commit_ opened with "I can't directly fetch the
> exact diff" and produced only hedged, generic "likely coupled" findings. Same
> transport, totally different value — grounding is the difference.

## 8.2 Full MVP flow (the demo)

```text
[ ] Step 1: cwc_status in Zed → mode:host, hosting:true, browser_connected:true.
[ ] AI edits code in Zed; commit to draft/<slug>; push.
[ ] Step 3: build-packet.sh → packet.json with the REMOTE commit_sha.
[ ] Step 2/4: fill-handoff.mjs → handoff-prompt.txt.
[ ] Step 4: send_to_codewebchat(url=ChatGPT project, text=prompt, prompt_type=edit-context) → ticket.
[ ] Click CodeWebChat Apply Response in the ChatGPT tab.
[ ] Step 4: poll_cwc_response → status:done with the review.
[ ] **8.1b grounding check: the review cites real code, not "I can't fetch the diff" / hedged guesses.**
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
- **The review is grounded** — it cites real code from the pushed commit, not
  guesses (8.1b). _Transport success ≠ useful review._ ✅

## 8.4 What "done" unlocks

When 8.2 passes, Review Handoff v0 is real: Zed → GitHub-connected ChatGPT review
→ feedback into Zed, with no VS Code and no new server code. Next:

1. **Add the inline `response_text` reply option** (reframed "Phase C") for clean
   review-text return — _in addition to_ the retained clipboard path (not a removal).
2. Promote to **v1 dedicated tools** (`09-step-v1-dedicated-tools.md`).
3. Tune prompts and add review-focus presets as one-click options.
