# Step 5 — Import the review into Zed (M5)

Goal: turn the `done` response into actionable items — parse the JSON block,
surface verdict/findings, and drive the fix pass with the feedback-back prompt.

## 5.1 Extract the JSON block (full example — no deps)

`scripts/review-handoff/parse-review.mjs`:

```js
#!/usr/bin/env node
// Usage: node parse-review.mjs < review.txt   (reads the poll "response" text)
import { readFileSync } from 'node:fs'

const text = readFileSync(0, 'utf8') // stdin

// Grab the last fenced ```json ... ``` block (the reviewer appends it).
const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)]
if (matches.length === 0) {
  console.error('no ```json block found; falling back to prose only')
  process.exit(3)
}
let review
try {
  review = JSON.parse(matches[matches.length - 1][1].trim())
} catch (e) {
  console.error('json block was not valid JSON:', e.message)
  process.exit(3)
}

// Normalize to the shape Step 6/feedback expects.
const out = {
  verdict: review.verdict ?? 'unknown',
  risk: review.risk ?? 'unknown',
  findings: Array.isArray(review.findings) ? review.findings : [],
  tests: Array.isArray(review.tests) ? review.tests : [],
  editor_patch_plan: Array.isArray(review.editor_patch_plan) ? review.editor_patch_plan : []
}
process.stdout.write(JSON.stringify(out, null, 2))
```

Run:

```bash
# save the poll "response" string to review.txt first
node scripts/review-handoff/parse-review.mjs < review.txt > review.json
```

## 5.2 Map to Zed actions

| Field | What to do in Zed |
| --- | --- |
| `verdict` | gate: `pass`/`pass_with_minor_changes` → optional; `needs_changes`/`blocked` → fix pass |
| `risk` | display; `high` → don't auto-anything, review manually |
| `findings[]` | each `{severity, path, title, recommended_fix}` → an inline task / TODO |
| `tests[]` | queue as test tasks |
| `editor_patch_plan[]` | becomes the ordered Zed agent task list |

## 5.3 Drive the fix pass (feedback-back prompt)

Fill `prompts/` §3 with the parsed fields and hand it to Zed's agent:

```text
Apply the following review feedback to the current working branch.
Context: repo {{repo_name}}, branch {{draft_branch}}, commit {{commit_sha}}.
Reviewer verdict: {{verdict}}
Blocking issues: {{findings where severity == high}}
Non-blocking improvements: {{findings where severity in [medium, low]}}
Suggested tests: {{tests}}
Instructions: fix blocking first; preserve intent; smallest coherent patch; then summarize.
```

## 5.4 Where Phase C plugs in

Today the review text returns via the OS clipboard (Apply → clipboard → `poll`).
For long structured reviews this is the fragile part. **Phase C**
(`plans/mcp-server-prototype-plan/06b`) makes the browser send `response_text`
inline, so Step 4's `done.response` is the review directly — no clipboard. When
you do Phase C, this step is unchanged except it gets cleaner, complete text every
time. That's why Phase C is now higher priority for this product.

## Done when

`parse-review.mjs` yields a valid `review.json`, and you can run the feedback-back
prompt to start fixes from it.
