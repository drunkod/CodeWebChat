# Step 6 — Hash-only audit log (V0)

**Source:** `draft/src/cli/mcp/audit.ts` (full module),
called from `draft/src/cli/mcp/tools.ts` `audit(...)` helper.

## Developer's answer (why hash, not raw)

> "Audit logging must record metadata and **input hashes, not raw prompts or
> secret-like content**. The worry is tool inputs can contain user-typed content
> (e.g. a PRD body with a pasted API key). Hashing means the log is safe to
> inspect, share, or commit. The hash still lets you correlate which call wrote
> what."
>
> "For your bridge: **yes, hash from day one.** If your tool input is
> `{ prompt: "..." }` and the user pasted a secret into the prompt, you don't
> want that in a log file."

This is directly relevant: your inputs are prompts and your outputs are
clipboard contents — both can carry secrets.

## Full source module

```ts
// draft/src/cli/mcp/audit.ts
import { createHash } from 'crypto'
import { appendFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { redactMcpText } from './redaction'

export function hashMcpInput(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function writeMcpAuditEntry(repoRoot: string, entry: McpAuditEntry): void {
  const logPath = join(repoRoot, '.ai', 'harness', 'mcp', 'audit.log')
  mkdirSync(dirname(logPath), { recursive: true })
  const safeEntry = { ...entry, error: entry.error ? redactMcpText(entry.error).text : undefined }
  appendFileSync(logPath, `${JSON.stringify(safeEntry)}\n`, 'utf-8')   // JSONL, append-only
}

export function tryWriteMcpAuditEntry(repoRoot: string, entry: McpAuditEntry): boolean {
  try { writeMcpAuditEntry(repoRoot, entry); return true } catch { return false }  // never crash the tool
}
```

Entry shape (`types.ts`): `{ timestamp, tool, status: 'ok'|'blocked'|'failed',
targetPath?, inputHash?, error? }`. The error field is redacted before writing.

## Adapt to `cwc-mcp-server`

```ts
// apps/mcp-server/src/audit.ts
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { redact } from './redaction.js'

const LOG = join(process.cwd(), '.cwc-mcp', 'audit.log')  // or a configurable dir

export function audit(entry: {
  tool: string
  status: 'ok' | 'blocked' | 'failed'
  input: unknown            // hashed, never stored raw
  chatbot?: string
  errorCode?: string
  error?: string
}) {
  try {
    mkdirSync(dirname(LOG), { recursive: true })
    const safe = {
      timestamp: new Date().toISOString(),
      tool: entry.tool,
      status: entry.status,
      chatbot: entry.chatbot,
      inputHash: createHash('sha256').update(JSON.stringify(entry.input)).digest('hex'),
      errorCode: entry.errorCode,
      error: entry.error ? redact(entry.error).text : undefined,
    }
    appendFileSync(LOG, JSON.stringify(safe) + '\n', 'utf-8')
  } catch { /* logging must never break the tool */ }
}
```

Call it at every exit of `send_to_codewebchat` and `cwc_status`:
`audit({ tool:'send_to_codewebchat', status:'ok', input: args, chatbot: args.chatbot })`.

## Important details to keep

- **Wrap in try/catch** — a failed log write must never fail the tool call.
- **JSONL append-only** — one line per call, greppable.
- **gitignore the log file** (step 9): `.cwc-mcp/audit.log`.
- You may also store an **output hash** (sha256 of the redacted clipboard text)
  to correlate "which reply" without storing the reply.

## Checklist

- [ ] `inputHash` (sha256 of JSON), never raw input.
- [ ] Errors redacted before writing.
- [ ] Writes wrapped so failures are swallowed.
- [ ] Log path gitignored.
