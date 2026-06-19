# Step 3 — Secret redaction + deny layer (V0)

**Source:** `draft/src/cli/mcp/redaction.ts` (full module),
deny list in `draft/src/cli/mcp/policy.ts:3-21`.

## ⚠️ Revision after the developer's answer

The original doc treated redaction as your main protection. The developer was
explicit that it is **not** enough on its own:

> "Should you trust it as the only layer? **No.** The primary layer is the deny
> glob list — `.env`, `*.pem`, `secrets/**`, `credentials/**` are blocked
> before any read happens. Redaction is a defense-in-depth backstop for content
> that slips through."
>
> Known limits: "Pattern-based, not semantic. `MY_TOKEN=abc123` is redacted, but
> `token: abc123` (no `=`) is not. No false-positive tracking was recorded."

Implication for you: your server returns **clipboard text**, for which there is
no path/deny layer — so redaction carries more weight *and* is imperfect. Treat
returned text as untrusted (step 1 instruction), redact it, and surface to the
user that redaction happened.

## Full source module (copy almost verbatim)

```ts
// draft/src/cli/mcp/redaction.ts
const REDACTION_PATTERNS = [
  { type: 'bearer_token', pattern: /Authorization:\s*Bearer\s+\S+/gi, replacement: 'Authorization: Bearer [REDACTED]' },
  { type: 'openai_key',   pattern: /sk-[A-Za-z0-9]{20,}/g,            replacement: 'sk-[REDACTED]' },
  { type: 'github_pat',   pattern: /ghp_[A-Za-z0-9]{20,}/g,           replacement: 'ghp_[REDACTED]' },
  { type: 'github_pat_v2',pattern: /github_pat_[A-Za-z0-9_]{30,}/g,   replacement: 'github_pat_[REDACTED]' },
  { type: 'aws_key',      pattern: /AKIA[0-9A-Z]{16}/g,               replacement: 'AKIA[REDACTED]' },
  { type: 'secret_assignment',
    pattern: /(^|[^\w])([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS)[A-Z0-9_]*)\s*([:=])\s*\S+/gi,
    replacement: '$1$2$3[REDACTED]' },
  { type: 'database_url',
    pattern: /(^|[^\w])((?:DATABASE_URL|POSTGRES_URL|MONGODB_URI|REDIS_URL))\s*([:=])\s*\S+/gi,
    replacement: '$1$2$3[REDACTED]' },
  { type: 'jwt_token',    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: '[JWT REDACTED]' },
  { type: 'private_key',  pattern: /-----BEGIN\s+(?:RSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g, replacement: '[PRIVATE KEY REDACTED]' },
]

export function redact(input: string) {
  const redactions: { type: string; count: number }[] = []
  let text = input
  for (const e of REDACTION_PATTERNS) {
    const m = text.match(e.pattern)
    if (!m) continue
    redactions.push({ type: e.type, count: m.length })
    text = text.replace(e.pattern, e.replacement)
  }
  return { text, redactions }
}
```

## Adapt to `cwc-mcp-server`

Redact at the single choke point where clipboard text leaves the server:

```ts
// in send_to_codewebchat, after reading clipboard:
const raw = await read_clipboard()
const { text, redactions } = redact(raw)
return textResult({ response: text, redactions })
```

Returning the `redactions` summary (types + counts, never values) lets the user
see "2 secrets were redacted from this reply" — good failure/trust UX.

### Consider a couple of extra patterns for your case

The clipboard can hold anything the user copied. Worth adding (the developer
noted the `token: value` gap):

```ts
{ type: 'colon_secret',
  pattern: /(^|[^\w])((?:api[_-]?key|secret|token|password|passwd|credentials))\s*:\s*\S+/gi,
  replacement: '$1$2: [REDACTED]' },
```

But do not over-trust regex — keep it as a backstop and keep the "untrusted
output, never execute" instruction from step 1.

## Checklist

- [ ] `redact()` module copied and unit-tested (step 5).
- [ ] Applied to clipboard output **and** error messages (step 2).
- [ ] `redactions` summary returned to the client (counts only).
- [ ] Documented as best-effort, not a guarantee.
