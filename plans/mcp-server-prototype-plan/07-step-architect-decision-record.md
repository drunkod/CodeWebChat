# Step 7 — Capture Architect Decisions as Code Defaults

## Goal

Turn the research answers into explicit defaults so the implementation does not accidentally drift into unsafe or unsupported behavior.

This step creates a small decision module, a runtime guard module, and a safety-focused test. These examples encode the current known facts:

- V0 is semi-automated.
- V0 returns raw response text only.
- V0 does not apply file edits.
- V0 serializes tool calls.
- V0 does not use `without_submission` because it is not part of the current protocol.
- V0 reads the clipboard only after `apply-chat-response`.
- V1 should add `request_id` and `response_text`.

## Complete file: `apps/mcp-server/src/decisions.ts`

```ts
export type AutomationMode = 'semi_automated' | 'fully_automated'
export type ResponseMode = 'raw_text' | 'parsed_file_edits'
export type EditApplicationMode = 'return_only' | 'apply_to_workspace'
export type ConcurrencyMode = 'serialized' | 'request_id_parallel'

export type ArchitectDecisions = {
  automation_mode: AutomationMode
  response_mode: ResponseMode
  edit_application_mode: EditApplicationMode
  concurrency_mode: ConcurrencyMode
  uses_clipboard_fallback: boolean
  requires_apply_response_click: boolean
  supports_without_submission: boolean
  requires_request_id_for_parallelism: boolean
  preferred_v1_protocol_fields: Array<'request_id' | 'response_text'>
}

export const ARCHITECT_DECISIONS: ArchitectDecisions = {
  automation_mode: 'semi_automated',
  response_mode: 'raw_text',
  edit_application_mode: 'return_only',
  concurrency_mode: 'serialized',
  uses_clipboard_fallback: true,
  requires_apply_response_click: true,
  supports_without_submission: false,
  requires_request_id_for_parallelism: true,
  preferred_v1_protocol_fields: ['request_id', 'response_text']
}

export const explainDecision = (key: keyof ArchitectDecisions): string => {
  switch (key) {
    case 'automation_mode':
      return 'V0 is semi-automated because the current browser extension signals apply-chat-response only after the user clicks Apply Response.'
    case 'response_mode':
      return 'V0 returns raw response text because CodeWebChat response parsing and workspace editing are VS Code-specific.'
    case 'edit_application_mode':
      return 'V0 does not apply edits. The parent MCP client or IDE agent should decide how to edit files.'
    case 'concurrency_mode':
      return 'V0 serializes calls because the current protocol correlates responses by client_id, not request_id.'
    case 'uses_clipboard_fallback':
      return 'V0 reads the clipboard because ApplyChatResponseMessage does not currently include response text.'
    case 'requires_apply_response_click':
      return 'The user must click Apply Response so the content script copies the chatbot response and sends the WebSocket signal.'
    case 'supports_without_submission':
      return 'The current InitializeChatMessage type does not include without_submission, so the MCP server must not expose it.'
    case 'requires_request_id_for_parallelism':
      return 'Parallel requests require request_id because multiple requests from the same MCP connection share one client_id.'
    case 'preferred_v1_protocol_fields':
      return 'V1 should add request_id for correlation and response_text to remove clipboard dependence.'
  }
}
```

## Complete file: `apps/mcp-server/src/guards.ts`

```ts
import { ARCHITECT_DECISIONS } from './decisions.js'

export type ToolInputWithPossibleUnsupportedFields = {
  without_submission?: unknown
  apply_edits?: unknown
  parse_response?: unknown
  [key: string]: unknown
}

export const rejectUnsupportedV0Fields = (input: ToolInputWithPossibleUnsupportedFields): void => {
  if ('without_submission' in input) {
    throw new Error(
      'without_submission is not supported by the current CodeWebChat InitializeChatMessage protocol. Remove this field or implement the V1 protocol upgrade first.'
    )
  }

  if (input.apply_edits === true) {
    throw new Error(
      'This MCP server returns raw chatbot text only. It must not apply workspace edits in V0.'
    )
  }

  if (input.parse_response === true) {
    throw new Error(
      'This MCP server does not parse CodeWebChat responses in V0. Let the MCP client or IDE agent parse/apply edits.'
    )
  }
}

export const getRuntimeSafetyBanner = (): string => {
  return [
    'CodeWebChat MCP V0 safety defaults:',
    `- automation: ${ARCHITECT_DECISIONS.automation_mode}`,
    `- response mode: ${ARCHITECT_DECISIONS.response_mode}`,
    `- edit application: ${ARCHITECT_DECISIONS.edit_application_mode}`,
    `- concurrency: ${ARCHITECT_DECISIONS.concurrency_mode}`,
    `- clipboard fallback: ${ARCHITECT_DECISIONS.uses_clipboard_fallback}`,
    `- requires Apply Response click: ${ARCHITECT_DECISIONS.requires_apply_response_click}`,
    `- supports without_submission: ${ARCHITECT_DECISIONS.supports_without_submission}`,
    `- V1 fields: ${ARCHITECT_DECISIONS.preferred_v1_protocol_fields.join(', ')}`
  ].join('\n')
}
```

## Complete MCP integration change

Add the guard and safety banner to `apps/mcp-server/src/index.ts`.

```ts
#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readSystemClipboard } from './clipboard.js'
import { CwcBridge } from './cwc-bridge.js'
import { toErrorText } from './errors.js'
import { getRuntimeSafetyBanner, rejectUnsupportedV0Fields } from './guards.js'

const bridge = new CwcBridge({
  read_clipboard: readSystemClipboard
})

const server = new McpServer(
  {
    name: 'cwc-mcp-server',
    version: '0.1.0'
  },
  {
    instructions: getRuntimeSafetyBanner()
  }
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
            text: JSON.stringify(
              {
                ...bridge.status(),
                safety: getRuntimeSafetyBanner()
              },
              null,
              2
            )
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
    description: 'Send a prompt to a CodeWebChat-supported chatbot. Returns raw response text after the user clicks Apply Response.',
    inputSchema: {
      url: z.string().url(),
      text: z.string().min(1),
      model: z.string().optional(),
      target_browser_id: z.number().int().positive().optional(),
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
      timeout_ms: z.number().int().positive().max(900000).optional()
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

## Complete test: `apps/mcp-server/test/guards.test.ts`

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { ARCHITECT_DECISIONS, explainDecision } from '../src/decisions.js'
import { getRuntimeSafetyBanner, rejectUnsupportedV0Fields } from '../src/guards.js'

test('architect decisions encode V0 safety defaults', () => {
  assert.equal(ARCHITECT_DECISIONS.automation_mode, 'semi_automated')
  assert.equal(ARCHITECT_DECISIONS.response_mode, 'raw_text')
  assert.equal(ARCHITECT_DECISIONS.edit_application_mode, 'return_only')
  assert.equal(ARCHITECT_DECISIONS.concurrency_mode, 'serialized')
  assert.equal(ARCHITECT_DECISIONS.uses_clipboard_fallback, true)
  assert.equal(ARCHITECT_DECISIONS.requires_apply_response_click, true)
  assert.equal(ARCHITECT_DECISIONS.supports_without_submission, false)
  assert.equal(ARCHITECT_DECISIONS.requires_request_id_for_parallelism, true)
  assert.deepEqual(ARCHITECT_DECISIONS.preferred_v1_protocol_fields, ['request_id', 'response_text'])
})

test('runtime safety banner is explicit', () => {
  const banner = getRuntimeSafetyBanner()
  assert.match(banner, /semi_automated/)
  assert.match(banner, /raw_text/)
  assert.match(banner, /serialized/)
  assert.match(banner, /request_id, response_text/)
})

test('unsupported V0 fields are rejected', () => {
  assert.throws(
    () => rejectUnsupportedV0Fields({ without_submission: true }),
    /without_submission is not supported/i
  )

  assert.throws(
    () => rejectUnsupportedV0Fields({ apply_edits: true }),
    /must not apply workspace edits/i
  )

  assert.throws(
    () => rejectUnsupportedV0Fields({ parse_response: true }),
    /does not parse CodeWebChat responses/i
  )
})

test('decision explanations are useful for future maintainers', () => {
  assert.match(explainDecision('automation_mode'), /Apply Response/)
  assert.match(explainDecision('requires_request_id_for_parallelism'), /client_id/)
  assert.match(explainDecision('preferred_v1_protocol_fields'), /response_text/)
})
```

## Architect review checklist

```text
[ ] Confirm V0 remains semi-automated.
[ ] Confirm raw text is the only V0 return value.
[ ] Confirm file edits are left to the parent MCP client or IDE.
[ ] Confirm no without_submission support is exposed in V0.
[ ] Confirm concurrency remains serialized until request_id is implemented.
[ ] Confirm V1 adds request_id and response_text.
[ ] Confirm clipboard fallback remains only for backward compatibility.
```
