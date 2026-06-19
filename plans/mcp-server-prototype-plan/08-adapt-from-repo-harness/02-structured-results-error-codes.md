# Step 2 — Structured tool results & stable error codes (V0)

**Source:** `draft/src/cli/mcp/tools.ts:30-38` (`textResult`, `errorResult`).

## ⚠️ Revision after the developer's answer

The original doc said to adopt `structuredContent`. **Drop that for V0.** The
developer confirmed:

> "`structuredContent` is **not** used — all tool results return
> `{ content: [{ type: 'text', text: ... }] }`. For V0: annotations are
> low-cost and worth adding. `structuredContent` is not worth the effort until
> clients actually use it."

So: **keep the machine-readable error codes** (high value, used in the E2E to
distinguish blocked vs. failed), and **return plain text content** — JSON
encoded as text when you need structure.

## What it does

Every result is `{ content: [{ type:'text', text }] }`. Errors are wrapped as
`{ error: { code, message, details } }` with a stable, machine-readable `code`,
and the message is run through redaction (step 3) before leaving the process.

## Source example

```ts
function textResult(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  };
}

function errorResult(code: string, message: string, details?: unknown): CallToolResult {
  return textResult({ error: { code, message: redactMcpText(message).text, details } });
}
```

Codes seen in the repo: `FILE_TOO_LARGE`, `WOULD_OVERWRITE`, `INVALID_GOAL`,
`POLICY_DENIED`, `NOT_A_FILE`, `INVALID_AGENT`, `AGENT_DENIED`
(`tools.ts:558`, `676`, etc.). Note errors are returned as a **tool result**
(text), not as a protocol-level error — so the client sees them as data it can
react to.

## Adapt to `cwc-mcp-server`

Define a small code enum for your two tools and reuse one helper:

```ts
// apps/mcp-server/src/results.ts
import { redact } from './redaction.js' // step 3

export type CwcErrorCode =
  | 'BRIDGE_NOT_CONNECTED'   // no WebSocket to localhost:55155
  | 'BROWSER_NOT_READY'      // editor/browser client not registered
  | 'APPLY_TIMEOUT'          // user never clicked Apply Response in time
  | 'CLIPBOARD_EMPTY'        // Apply clicked but clipboard had no text
  | 'CLIPBOARD_UNCHANGED'    // clipboard equals pre-send value (no apply?)
  | 'INVALID_INPUT'

export function textResult(value: unknown) {
  return { content: [{ type: 'text' as const,
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }
}

export function errorResult(code: CwcErrorCode, message: string, details?: unknown) {
  return textResult({ error: { code, message: redact(message).text, details } })
}
```

Then `send_to_codewebchat` returns either `textResult({ response: text })` or
`errorResult('APPLY_TIMEOUT', 'no Apply Response within 120s')`.

## Why codes matter for you

Your clipboard/apply flow is fragile (your own note). Codes let your tests in
Step 5 assert the exact failure (`expect(err.code).toBe('APPLY_TIMEOUT')`)
instead of matching prose, and let clients show the right next step to the user.

## Checklist

- [ ] One `textResult` + one `errorResult` helper.
- [ ] Error `message` passed through redaction.
- [ ] Codes are a closed TypeScript union, asserted in tests.
- [ ] Do **not** add `structuredContent` yet.
