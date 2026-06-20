# Step 9 — v1: dedicated review tools (option 2)

After the MVP loop is proven, promote the hand-built prompt flow into **dedicated
MCP tools** so any client (Zed, Cursor, Claude Desktop) gets the review handoff
without assembling prompts by hand. This is the "more universal" phase.

## 9.1 New tools (added to `apps/mcp-server`)

```ts
// prepare_review_handoff — gather git metadata server-side, return packet + filled prompt
{
  name: 'prepare_review_handoff',
  inputSchema: {
    base_branch?: string        // default 'main'
    review_focus?: string       // preset string
    summary?: string            // optional; else derive from commit body
  }
  // → { packet: HandoffPacket, prompt: string }
}

// request_review — wraps prepare + send_to_codewebchat begin
{
  name: 'request_review',
  inputSchema: {
    chatgpt_url: string
    base_branch?: string
    review_focus?: string
    summary?: string
  }
  // → { ticket, reviewed_sha }
}

// import_review_feedback — poll + parse JSON + SHA-gate
{
  name: 'import_review_feedback',
  inputSchema: { ticket: string, force?: boolean }
  // → { verdict, risk, findings[], tests[], editor_patch_plan[], stale: boolean }
}
```

## 9.2 Where the logic comes from (reuse, don't reinvent)

| New tool internals | Reuse from |
| --- | --- |
| git repo + remote SHA | port `apps/editor/src/utils/git-repository-utils.ts` |
| changed files | `commands/apply-context-command/sources/commit-files-source.ts` |
| auto commit summary | `utils/prompts-for-commit-messages-utils.ts` |
| send + poll | existing `RequestRegistry.begin` / `poll` |
| prompt fill | the Step 2 template + fill logic, moved server-side |
| SHA gate | Step 6 `check-sha.sh` logic, made a hard gate |

Implementation note: factor a `ReviewHandoff` module that takes the `RequestRegistry`
(constructor injection, like the registry takes the transport) so it's unit-testable
with a fake transport — same pattern as the host-mode tests.

## 9.3 Universal-phase features (after the three tools)

- **Git automation:** auto-create `draft/<slug>`, commit with AI message, push,
  confirm remote HEAD (the research's top correctness finding, now built-in).
- **Review-mode presets** as structured input (bug-risk / architecture / tests /
  merge-readiness), reusing the editor "Configurations/presets" concept.
- **Multi-reviewer fan-out:** send to Claude + Gemini + ChatGPT (the browser
  integrations already exist) and diff the verdicts.
- **Phase C complete:** `request_id` + inline `response_text` → clipboard fully out
  of the return path; `import_review_feedback` reads `response_text` directly.
- **Editor-agnostic docs:** MCP config snippets for Zed, VS Code, Cursor.
- **Round-trip to a task list:** `editor_patch_plan[]` → Zed agent tasks.

## 9.4 Tests to add (mirror the prototype-plan rigor)

- Unit: `prepare_review_handoff` builds a correct packet from a fake git repo.
- Unit: `import_review_feedback` parses the JSON block and flags `stale` on SHA drift.
- Integration: `request_review` → fake browser apply with a canned review →
  `import_review_feedback` returns the parsed verdict (mirrors T.3 host-mode test).

## Done when

A single `request_review` call (no hand-built prompt) sends the review and
`import_review_feedback` returns parsed, SHA-checked feedback — the MVP flow,
now one tool call.
