# Step 2 — Prompt pack + fill helper (M2)

Goal: have the four review prompts as reusable templates, plus a tiny helper that
fills the handoff template from a packet. The full prompt text lives in
`docs/zed-review-handoff/prompts/review-handoff-prompts.md`; this step makes them
*operational*.

## 2.1 The packet shape (the single source of truth)

```ts
// the JSON object every step passes around
type HandoffPacket = {
  repo_name: string        // "owner/repo"
  base_branch: string      // "main"
  draft_branch: string     // "draft/<slug>"
  commit_sha: string       // remote HEAD after push
  commit_title: string
  change_summary: string
  changed_files: string[]  // repo-relative paths
  review_focus: string     // a preset string (see prompts doc)
}
```

## 2.2 Handoff template (file)

Save the §2 handoff template to `plans/review-handoff-plan/templates/handoff.txt`
with `{{...}}` placeholders, e.g.:

```text
Please review the latest draft implementation in the connected GitHub repository.

Repository: {{repo_name}}
Base branch: {{base_branch}}
Draft branch: {{draft_branch}}
Head commit: {{commit_sha}}
Commit title: {{commit_title}}

Author summary:
{{change_summary}}

Files changed:
{{changed_files}}

Review focus:
{{review_focus}}

Instructions:
- Review the diff introduced by {{commit_sha}} on {{draft_branch}} relative to {{base_branch}}.
- Use the connected GitHub repository as the source of truth.
- Ignore unrelated repository issues unless they directly affect this change.
- Flag correctness issues first, then test gaps, then maintainability issues.
- If the change is acceptable, say what is still worth tightening before merge.

Return your answer in this structure:

Verdict:
Risk:
Blocking issues:
Non-blocking improvements:
Suggested tests:
Editor feedback packet:

Then append a fenced ```json block: {verdict, risk, findings[], tests[], editor_patch_plan[]}.
```

## 2.3 Fill helper (full example — pure Node, no deps)

`scripts/review-handoff/fill-handoff.mjs`:

```js
#!/usr/bin/env node
// Usage: node fill-handoff.mjs packet.json templates/handoff.txt
import { readFileSync } from 'node:fs'

const [, , packetPath, templatePath] = process.argv
if (!packetPath || !templatePath) {
  console.error('usage: fill-handoff.mjs <packet.json> <template.txt>')
  process.exit(2)
}

const packet = JSON.parse(readFileSync(packetPath, 'utf8'))
let template = readFileSync(templatePath, 'utf8')

// changed_files: array -> newline list
const view = {
  ...packet,
  changed_files: Array.isArray(packet.changed_files)
    ? packet.changed_files.join('\n')
    : String(packet.changed_files ?? '')
}

const filled = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  if (!(key in view)) throw new Error(`missing packet field: ${key}`)
  return String(view[key])
})

process.stdout.write(filled)
```

Run:

```bash
node scripts/review-handoff/fill-handoff.mjs packet.json \
  plans/review-handoff-plan/templates/handoff.txt > handoff-prompt.txt
```

`handoff-prompt.txt` is exactly what Step 4 sends as `send_to_codewebchat.text`.

## 2.4 Review-focus presets

Pick one string for `review_focus` (from the prompts doc):

| Preset | `review_focus` |
| --- | --- |
| Bug risk | "Correctness and regressions only. Assume the design is fixed." |
| Architecture | "Architecture drift, coupling, and boundaries. Skip nits." |
| Test adequacy | "Test coverage and gaps for this change; propose concrete tests." |
| Merge readiness | "Is this safe to merge? List only blockers and required tightening." |

## Done when

`fill-handoff.mjs` produces a complete, human-readable handoff prompt from a
packet JSON with no `{{...}}` left unresolved.
