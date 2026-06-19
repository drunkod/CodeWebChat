# Step 12 — The developer's one-page MCP server starter checklist

Reproduced from the Q&A (Q18), annotated with where each item lives in this
plan and in the `draft/` source. Use it as the acceptance gate for V0.

| # | Checklist item (developer's words) | Plan step | Source |
| --- | --- | --- | --- |
| 1 | **Define your boundary first** — write the server `instructions` string before any code. It forces the decision. | 01 | `instructions.ts` |
| 2 | **Policy before tools** — implement read/write/deny scope before any tool handler. | 08 (if file tools) | `policy.ts`, `types.ts` |
| 3 | **Path resolution is non-trivial** — handle absolute, `..`, symlink escape, Windows `sep`, POSIX normalize. Don't roll your own glob untested. | 08 | `paths.ts` |
| 4 | **Redact before returning** — apply to all output text, not just errors. (But it's a backstop, not the only layer.) | 03 | `redaction.ts` |
| 5 | **Hash inputs in the audit log** — never store raw tool arguments. | 06 | `audit.ts` |
| 6 | **Annotate all tools** — `readOnlyHint`, `openWorldHint`, `destructiveHint`. Clients use these for confirmation UX. | 04 | `tools.ts:379` |
| 7 | **stdio is 8 lines; HTTP is 370** — don't add HTTP until you need a remote client. | 10 | `transports/` |
| 8 | **No arbitrary shell** — if you need execution, fix the command and args server-side. | (n/a for bridge) | `tools.ts:694` |
| 9 | **`additionalProperties: false` on all input schemas** — rejects unknown fields, forward-compat. | 04 | `tools.ts:385` |
| 10 | **gitignore secrets and the audit log from day one.** | 06, 09 | `setup.ts:180` |

## Other landmines the developer flagged

- **Pin the MCP SDK version.** The HTTP/auth handler imports are deep subpaths
  (`/server/auth/handlers/...`) that "are not part of the stable public API and
  have moved between versions." (Q17)
- **Understand the `instructions` field early** — "the single most effective way
  to constrain model behavior," and the first 512 chars must be self-contained.
  (Q19)
- **Versioning is additive-only** — keep tool schemas stable, add new tools, and
  let `additionalProperties: false` reject a newer client's unknown fields. No
  explicit version negotiation was built. (Q12)
- **Run the connect E2E before finalizing auth** — the OAuth-vs-bearer surprise
  was only caught in a manual end-to-end test, not in design. (Q4, Q20)

## V0 acceptance gate for `cwc-mcp-server`

Ship V0 when:

- [ ] Self-contained `instructions` string, boundary stated, first 512 chars OK.
- [ ] Two tools (`cwc_status`, `send_to_codewebchat`) with annotations + strict
      schemas.
- [ ] One `errorResult` helper with a closed `CwcErrorCode` union.
- [ ] Clipboard output + error messages run through `redact()`.
- [ ] **Blocking design decided BEFORE tool implementation** (recommend split
      send+poll, step 7) and recorded in the ADR — it sets the schema + codes.
- [ ] `cwc_doctor` shipping in V0 (WS on 55155 + clipboard), each failure with a
      fix string (step 11).
- [ ] Hash-only audit log, writes wrapped in try/catch, log gitignored.
- [ ] Effects (WS, clock, clipboard) injected — general testability pattern, not
      a repo-harness copy; unit + integration + stdio smoke tests green.
- [ ] SDK version pinned.

## What's still open (resolve with the developer / in the ADR)

1. **A vs C for the blocking call** (step 7) — confirm your client's request
   timeout to pick. Decide before main-plan Step 3.
2. Extra redaction patterns for clipboard content (`token: value` gap, step 3).
