#!/usr/bin/env node
// Extract the last ```json block from a review reply and normalize it.
// Usage: node parse-review.mjs < review.txt   (reads the poll "response" text on stdin)
import { readFileSync } from 'node:fs'

const text = readFileSync(0, 'utf8')

const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)]
if (matches.length === 0) {
  console.error('parse-review: no ```json block found (prose-only reply)')
  process.exit(3)
}

let review
try {
  review = JSON.parse(matches[matches.length - 1][1].trim())
} catch (e) {
  console.error('parse-review: json block was not valid JSON:', e.message)
  process.exit(3)
}

const out = {
  verdict: review.verdict ?? 'unknown',
  risk: review.risk ?? 'unknown',
  findings: Array.isArray(review.findings) ? review.findings : [],
  tests: Array.isArray(review.tests) ? review.tests : [],
  editor_patch_plan: Array.isArray(review.editor_patch_plan)
    ? review.editor_patch_plan
    : []
}
process.stdout.write(JSON.stringify(out, null, 2))
