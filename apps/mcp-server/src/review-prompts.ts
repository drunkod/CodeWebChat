import type { HandoffPacket } from './git-context.js'

export const REVIEWER_SYSTEM_PROMPT = [
  'You are a senior code reviewer operating on a GitHub-connected repository.',
  'Review only the code related to the requested branch and commit range.',
  'Prefer evidence from the connected repository over assumptions.',
  'Focus on correctness, regressions, missing tests, architecture drift,',
  'security/privacy risks, unclear naming or hidden coupling, and places where',
  'the implementation does not match the stated intent.',
  'Do not be vague. If evidence is missing, say exactly what is missing.',
  'Do not review unrelated files.'
].join(' ')

const HANDOFF_TEMPLATE = `Please review the latest draft implementation in the connected GitHub repository.

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
- IMPORTANT: if you cannot fetch the commit from the connected repo, say so first and stop; do not guess.

Return your answer in this structure:

Verdict:
Risk:
Blocking issues:
Non-blocking improvements:
Suggested tests:
Editor feedback packet:

Then append a fenced \`\`\`json block with this schema:
{ "verdict": "...", "risk": "...", "findings": [ { "severity": "...", "path": "...", "title": "...", "why_it_matters": "...", "recommended_fix": "..." } ], "tests": ["..."], "editor_patch_plan": ["..."] }`

export function fillHandoff(packet: HandoffPacket): string {
  const view: Record<string, string> = {
    repo_name: packet.repo_name,
    base_branch: packet.base_branch,
    draft_branch: packet.draft_branch,
    commit_sha: packet.commit_sha,
    commit_title: packet.commit_title,
    change_summary: packet.change_summary,
    review_focus: packet.review_focus,
    changed_files: packet.changed_files.join('\n')
  }
  return HANDOFF_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in view)) {
      throw new Error(`missing packet field: ${key}`)
    }
    return view[key]
  })
}

export type ReviewFinding = {
  severity?: string
  path?: string
  title?: string
  why_it_matters?: string
  recommended_fix?: string
}

export type ParsedReview = {
  verdict: string
  risk: string
  findings: ReviewFinding[]
  tests: string[]
  editor_patch_plan: string[]
}

/** Extract and normalize the last fenced ```json block from a review reply. */
export function parseReview(text: string): ParsedReview | null {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)]
  if (matches.length === 0) {
    return null
  }
  let raw: unknown
  try {
    raw = JSON.parse(matches[matches.length - 1][1].trim())
  } catch {
    return null
  }
  const review = raw as Partial<ParsedReview>
  return {
    verdict: typeof review.verdict === 'string' ? review.verdict : 'unknown',
    risk: typeof review.risk === 'string' ? review.risk : 'unknown',
    findings: Array.isArray(review.findings) ? review.findings : [],
    tests: Array.isArray(review.tests) ? review.tests : [],
    editor_patch_plan: Array.isArray(review.editor_patch_plan)
      ? review.editor_patch_plan
      : []
  }
}
