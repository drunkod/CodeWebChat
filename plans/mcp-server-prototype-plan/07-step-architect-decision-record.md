# Step 7 — Capture Architect Decisions as Code and Documentation

## Goal

Turn the research answers into explicit, durable artifacts so the implementation does not accidentally drift into unsafe or unsupported behavior.

This step produces two things:

1. **`DECISIONS.md`** — a human-readable Architecture Decision Record (ADR) committed alongside the code. Decisions belong in prose, not in a TypeScript module that ships to users.
2. **`guards.ts`** — a small runtime module that enforces the decisions as errors at call time. Runtime guards are genuinely useful; a `decisions.ts` object that is only read by tests is not.

The original plan had a `decisions.ts` module that duplicated information already in `DECISIONS.md`. Shipping an `ARCHITECT_DECISIONS` object as production code adds surface area with no runtime benefit. The tests for it (`architect decisions encode V0 safety defaults`) only verify that constants equal themselves — they add no coverage of actual behavior. Those tests are replaced here by tests that verify the guards actually reject bad input.

---

## File 1: `apps/mcp-server/DECISIONS.md`

```markdown
# Architecture Decision Record — cwc-mcp-server

## ADR-001: V0 is semi-automated

**Status:** Accepted  
**Date:** 2026-06

### Context

The browser extension's `ApplyChatResponseMessage` carries no response text — it is purely a
signal. The actual AI response is in the OS clipboard, copied by the browser extension only
after the user clicks **Apply Response** in the chatbot tab.

### Decision

V0 is semi-automated. The user must click Apply Response. The MCP server waits, then reads
the OS clipboard.

### Consequences

- MCP clients must inform users that a manual click is required.
- `send_to_codewebchat` tool description says so explicitly.
- `timeout_ms` defaults to 300,000 ms (5 minutes) to give the user time to review and click.

---

## ADR-002: V0 returns raw response text only

**Status:** Accepted  
**Date:** 2026-06

### Context

CodeWebChat's VS Code extension parses chatbot responses and applies file edits using
workspace-specific context (open editors, diff tools, VS Code API). That logic is not
portable to a standalone Node process.

### Decision

The MCP server returns raw clipboard text only. It does not parse edit formats, apply
file changes, or interact with any IDE. The parent MCP client or IDE agent decides how
to use the text.

### Consequences

- No `apply_edits` or `parse_response` fields are exposed in V0 tools.
- `guards.ts` rejects these fields if passed.

---

## ADR-003: V0 serializes tool calls

**Status:** Accepted  
**Date:** 2026-06

### Context

`client_id` identifies the editor connection, not an individual request. Multiple
simultaneous `send_to_codewebchat` calls from the same MCP process share one `client_id`.
If two calls are in flight, an `apply-chat-response` could resolve the wrong promise.

### Decision

V0 uses a promise chain to serialize all tool calls within a single MCP server process.
Only one `initialize-chat` is in flight at a time.

### Consequences

- Simple and safe for single-agent use.
- Not suitable for concurrent multi-agent use without V1 (`request_id`).

---

## ADR-004: V0 uses the OS clipboard as response transport

**Status:** Accepted — superseded by ADR-007 in V1  
**Date:** 2026-06

### Context

`ApplyChatResponseMessage` contains no `response_text` field. Adding it requires changes
to the shared protocol, the browser extension, and all 20+ chatbot integrations.

### Decision

V0 reads the OS clipboard after `apply-chat-response` arrives. The bridge verifies that
the clipboard changed to avoid returning stale content.

### Consequences

- Works on macOS and Windows out of the box.
- Linux requires `xclip`, `xsel`, or `wl-clipboard`.
- A 250 ms delay after `apply-chat-response` is sufficient because the browser extension
  already waits 500 ms before sending the signal.

---

## ADR-005: V0 does not support `without_submission`

**Status:** Accepted  
**Date:** 2026-06

### Context

`InitializeChatMessage` in the current codebase does not include a `without_submission`
field. Adding it to the MCP tool and sending it would have no effect and would mislead
callers.

### Decision

`without_submission` is not exposed. `guards.ts` rejects it if passed.

---

## ADR-006: Disconnect rejects in-flight promises immediately

**Status:** Accepted  
**Date:** 2026-06

### Context

The original V0 bridge set `pending_apply_response = null` in the WebSocket `close`
handler. The in-flight promise remained suspended until `timeout_ms` (default 5 minutes)
fired — giving the MCP client no feedback that the connection was lost.

### Decision

The `close` handler calls `pending_apply_response.reject(CWC_DISCONNECTED)` immediately.
`CwcBridgeV1` does the same for all entries in `pending_requests`.

### Consequences

- MCP clients see a fast, actionable error instead of a 5-minute hang.
- Callers should retry after ensuring the VS Code extension is running.

---

## ADR-007: V1 adds `request_id` and `response_text` to reduce clipboard dependence (clipboard retained)

**Status:** Proposed  
**Date:** 2026-06

### Context

V0 limitations: clipboard is the _only_ return path, single in-flight request per
connection. (Decision: keep the clipboard as a supported fallback; add an inline
path rather than removing it.)

### Decision

V1 adds optional `request_id` (UUID) to `InitializeChatMessage`. The browser extension
echoes it in `ApplyChatResponseMessage` along with `response_text` extracted from the
DOM. Both fields are optional so existing VS Code clients are unaffected.

Each chatbot integration implements `extract_response_text` using chatbot-specific DOM
selectors. A generic selector heuristic is not used because it is unreliable across
production chatbot DOMs.

### Consequences

- Clipboard is no longer the _only_ path for updated chatbot integrations, but it is
  retained as the fallback (inline `response_text` preferred when present).
- Concurrent requests are safe when `request_id` is present.
- 20+ chatbot integrations need per-chatbot `extract_response_text` implementations.
  Done incrementally: Claude, ChatGPT, Gemini first; the rest in follow-up PRs.
- Existing VS Code clipboard flow is fully backward compatible.

---

## ADR-008: The MCP server hosts the WebSocket relay (Mode B) to replace the editor extension

**Status:** Proposed
**Date:** 2026-06

### Context

The WebSocket server on `localhost:55155` is hosted by the VS Code **editor**
extension (`apps/editor/src/services/websocket-server-process.ts`). The browser
extension is only a client of that port. Steps 1–4 build the MCP server as an
additional **editor client** (Mode A), which means the VS Code extension must be
running to host the server. That validates the browser handshake but does not
replace the extension — the stated goal.

### Decision

Two phases:

- **Phase A — client mode (Mode A):** keep Steps 1–4 as a validation harness. The
  MCP server connects to the existing relay with token `gemini-coder-vscode`.
  Requires VS Code running.
- **Phase B — host mode (Mode B), the deliverable:** the MCP server _hosts_ the
  relay on 55155 itself (port the minimum of `WebSocketServer` per Step 2b). The
  browser extension connects directly to the MCP server; VS Code is not involved.

A `--mode host|client` flag selects between them; default `client` until host
mode is validated. The two modes are mutually exclusive at runtime because only
one process can bind 55155.

### Consequences

- Host mode adds a new failure code `CWC_PORT_IN_USE` (VS Code or a stale process
  owns 55155).
- `cwc_status` gains `mode` and `hosting` fields.
- Most Step 2 client logic (serialization, clipboard guard, disconnect rejection)
  is reused as the host's internal editor side; only the transport direction
  changes. See `02b-step-host-websocket-relay.md`.
- Definition of done: the Step 4 manual demo passes with the VS Code extension
  **closed**.

---

## ADR-009: Long-running tool call strategy (blocking vs split send+poll)

**Status:** Accepted — **Option C (split `send` + `poll`)**, after Phase A (A.4) proved the blocking path works
**Date:** 2026-06-20

### Context

`send_to_codewebchat` blocks on an unbounded human action (clicking Apply
Response). repo-harness has no pattern for this. See
`08-adapt-from-repo-harness/07-blocking-human-in-the-loop.md`.

### Decision

**Chosen: Option C — split `send_to_codewebchat` + `poll_cwc_response`.** `send`
returns a ticket immediately; `poll` returns the reply when ready or `pending`
after a short capped wait (≤30s). This survives MCP-client request timeouts (the
Inspector's 60s "Maximum Total Timeout" forced this realization during A.4),
because the unbounded human delay now lives _between_ calls, not inside one.

Implementation for the current client-mode code reuses the existing
`sendPromptAndWait` via `beginPrompt`/`pollPrompt` — see the "Client-mode
adaptation" section of `03b-split-send-poll-reference-code.md`. When Phase B lands,
swap to the transport-based `RequestRegistry`.

Rejected: Option A (single blocking call) — works (proven in A.4) but a real
client can abort mid-block, and naive model retries would re-spam the chatbot.

### Consequences

- New error code `CWC_UNKNOWN_TICKET` (and optional `CWC_BUSY`).
- Tool surface becomes two tools; server `instructions` describe the
  send → click Apply → poll flow.
- Once Phase C adds `request_id`, concurrent tickets become safe (drop the
  one-in-flight serialization).
```

---

## File 2: `apps/mcp-server/src/guards.ts`

Runtime enforcement only. No `ARCHITECT_DECISIONS` object — that information lives in `DECISIONS.md`.

```ts
/**
 * Runtime guards that enforce V0 architectural decisions at call time.
 * See DECISIONS.md for the rationale behind each guard.
 */

export type ToolInputWithPossibleUnsupportedFields = {
  without_submission?: unknown
  apply_edits?: unknown
  parse_response?: unknown
  [key: string]: unknown
}

/**
 * Rejects tool input fields that are not supported in V0.
 * Throws a descriptive Error so the MCP client sees exactly what is wrong.
 */
export const rejectUnsupportedV0Fields = (
  input: ToolInputWithPossibleUnsupportedFields
): void => {
  if ('without_submission' in input) {
    throw new Error(
      'without_submission is not supported by the current CodeWebChat InitializeChatMessage ' +
        'protocol (ADR-005). Remove this field or implement the V1 protocol upgrade first.'
    )
  }

  if (input.apply_edits === true) {
    throw new Error(
      'apply_edits is not supported in V0 (ADR-002). ' +
        'This MCP server returns raw chatbot text only. ' +
        'Let the parent MCP client or IDE agent parse and apply edits.'
    )
  }

  if (input.parse_response === true) {
    throw new Error(
      'parse_response is not supported in V0 (ADR-002). ' +
        'This MCP server does not parse CodeWebChat response formats. ' +
        'Let the parent MCP client or IDE agent handle parsing.'
    )
  }
}

/**
 * Returns a one-paragraph plain-text summary of V0 constraints for use
 * as the MCP server's `instructions` field, so MCP clients understand
 * what the server can and cannot do before calling any tool.
 */
export const getServerInstructions = (): string =>
  [
    'CodeWebChat MCP Server V0.',
    'Semi-automated: the user must click Apply Response in the browser chatbot tab (ADR-001).',
    'Returns raw response text only — no file editing or response parsing (ADR-002).',
    'Serializes tool calls — do not call send_to_codewebchat concurrently (ADR-003).',
    'Uses OS clipboard as response transport; Linux requires xclip, xsel, or wl-clipboard (ADR-004).',
    'Does not support without_submission (ADR-005).'
  ].join(' ')
```

---

## File 3: updated `apps/mcp-server/src/index.ts`

```ts
#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readSystemClipboard } from './clipboard.js'
import { CwcBridge } from './cwc-bridge.js'
import { toErrorText } from './errors.js'
import { getServerInstructions, rejectUnsupportedV0Fields } from './guards.js'

const bridge = new CwcBridge({
  read_clipboard: readSystemClipboard
})

const server = new McpServer(
  { name: 'cwc-mcp-server', version: '0.1.0' },
  { instructions: getServerInstructions() }
)

server.registerTool(
  'cwc_status',
  {
    title: 'CodeWebChat Status',
    description: 'Check CodeWebChat WebSocket and browser-extension status.',
    inputSchema: {}
  },
  async () => {
    try {
      await bridge.connect()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(bridge.status(), null, 2)
          }
        ]
      }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: toErrorText(error) }]
      }
    }
  }
)

server.registerTool(
  'send_to_codewebchat',
  {
    title: 'Send Prompt To CodeWebChat',
    description: [
      'Send a prompt to a CodeWebChat-supported browser chatbot.',
      'The user must click Apply Response in the chatbot tab.',
      'Returns the raw clipboard text copied by the browser extension.',
      'Do not call this tool concurrently from the same MCP server process.'
    ].join(' '),
    inputSchema: {
      url: z
        .string()
        .url()
        .describe(
          'Target chatbot URL, e.g. https://claude.ai/new or https://chatgpt.com/.'
        ),
      text: z.string().min(1).describe('Prompt to send to the chatbot.'),
      model: z.string().optional().describe('Optional chatbot model name.'),
      target_browser_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Optional browser client ID when multiple browsers are connected.'
        ),
      temperature: z.number().min(0).max(2).optional(),
      thinking_budget: z.number().int().positive().optional(),
      reasoning_effort: z.string().optional(),
      top_p: z.number().min(0).max(1).optional(),
      system_instructions: z.string().optional(),
      options: z.array(z.string()).optional(),
      raw_instructions: z.string().optional(),
      edit_format: z.string().optional(),
      prompt_type: z.string().optional(),
      reuse_last_tab: z.boolean().optional(),
      invocation_count: z.number().int().positive().max(10).optional(),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .max(900000)
        .optional()
        .describe(
          'Max ms to wait for Apply Response click. Default 300000 (5 min).'
        )
    }
  },
  async (input) => {
    try {
      rejectUnsupportedV0Fields(input)
      const response = await bridge.sendPromptAndWait(input)
      return {
        content: [{ type: 'text', text: response }]
      }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: toErrorText(error) }]
      }
    }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
```

---

## File 4: `apps/mcp-server/test/guards.test.ts`

Tests verify that guards actually reject bad input — not that constants equal themselves.

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  rejectUnsupportedV0Fields,
  getServerInstructions
} from '../src/guards.js'

test('rejectUnsupportedV0Fields rejects without_submission (ADR-005)', () => {
  assert.throws(
    () => rejectUnsupportedV0Fields({ without_submission: true }),
    /without_submission is not supported/i
  )
  assert.throws(
    () => rejectUnsupportedV0Fields({ without_submission: false }),
    /without_submission is not supported/i,
    'should reject even when the value is false — the field itself is unsupported'
  )
})

test('rejectUnsupportedV0Fields rejects apply_edits (ADR-002)', () => {
  assert.throws(
    () => rejectUnsupportedV0Fields({ apply_edits: true }),
    /apply_edits is not supported/i
  )
})

test('rejectUnsupportedV0Fields rejects parse_response (ADR-002)', () => {
  assert.throws(
    () => rejectUnsupportedV0Fields({ parse_response: true }),
    /parse_response is not supported/i
  )
})

test('rejectUnsupportedV0Fields allows valid V0 fields through', () => {
  // Should not throw for normal tool input
  assert.doesNotThrow(() =>
    rejectUnsupportedV0Fields({
      url: 'https://claude.ai/new',
      text: 'Hello',
      system_instructions: 'Be concise.',
      reuse_last_tab: true,
      timeout_ms: 60000
    })
  )
})

test('getServerInstructions mentions key V0 constraints', () => {
  const instructions = getServerInstructions()
  assert.match(
    instructions,
    /Apply Response/i,
    'should mention the required user action'
  )
  assert.match(
    instructions,
    /raw response text/i,
    'should clarify no file editing'
  )
  assert.match(
    instructions,
    /concurrently/i,
    'should warn against concurrent calls'
  )
  assert.match(instructions, /clipboard/i, 'should mention clipboard transport')
  assert.match(
    instructions,
    /without_submission/i,
    'should mention unsupported field'
  )
})
```

---

## Architect review checklist

```text
[ ] DECISIONS.md committed to apps/mcp-server/ alongside source code.
[ ] No ARCHITECT_DECISIONS object shipped in production JS bundle.
[ ] guards.ts rejects without_submission, apply_edits, parse_response.
[ ] getServerInstructions() used as MCP server instructions field.
[ ] Guards tests verify behavior, not constant equality.
[ ] V1 decisions referenced in ADR-007 with "Proposed" status.
```
