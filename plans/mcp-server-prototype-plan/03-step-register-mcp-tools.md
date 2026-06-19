# Step 3 — Register the MCP Tools

> **Decision pending (ADR-009):** the blocking single-tool design below is
> Option A. The recommended **Option C — split `send_to_codewebchat` +
> `poll_cwc_response`** (survives MCP client request timeouts) has complete
> reference code in **`03b-split-send-poll-reference-code.md`**. Decide before
> finalizing this schema.

## Goal

Expose a small, safe tool surface to MCP clients.

The V0 tool surface should be intentionally small:

1. `cwc_status` — confirms WebSocket/client/browser status.
2. `send_to_codewebchat` — sends a prompt to a supported chatbot and waits for the user to click **Apply Response**.

The MCP server should return raw chatbot text only. CodeWebChat's VS Code apply pipeline is editor-specific and should not be copied into this MCP server for V0.

## Complete file: `apps/mcp-server/src/index.ts`

```ts
#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readSystemClipboard } from './clipboard.js'
import { CwcBridge } from './cwc-bridge.js'
import { toErrorText } from './errors.js'

const bridge = new CwcBridge({
  read_clipboard: readSystemClipboard
})

const server = new McpServer(
  {
    name: 'cwc-mcp-server',
    version: '0.1.0'
  },
  {
    instructions: [
      'This server sends prompts to CodeWebChat-supported browser chatbots.',
      'The current implementation is semi-automated.',
      'After the chatbot responds, the user must click CodeWebChat Apply Response.',
      'The server then reads the OS clipboard and returns the copied response text.',
      'Do not call send_to_codewebchat concurrently from the same MCP server process.'
    ].join('\n')
  }
)

server.registerTool(
  'cwc_status',
  {
    title: 'CodeWebChat Status',
    description: 'Check whether the MCP server can connect to CodeWebChat and whether a browser extension is connected.',
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
        content: [
          {
            type: 'text',
            text: toErrorText(error)
          }
        ]
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
      'Wait for the user to click Apply Response.',
      'Return the raw clipboard text copied by the browser extension.'
    ].join(' '),
    inputSchema: {
      url: z.string().url().describe('Target chatbot URL, such as https://claude.ai/new or https://chatgpt.com/.'),
      text: z.string().min(1).describe('Prompt and code context to send to the chatbot.'),
      model: z.string().optional().describe('Optional chatbot model name, if the selected CodeWebChat integration supports it.'),
      target_browser_id: z.number().int().positive().optional().describe('Optional browser client ID when multiple browsers are connected.'),
      temperature: z.number().min(0).max(2).optional().describe('Optional sampling temperature.'),
      thinking_budget: z.number().int().positive().optional().describe('Optional Claude thinking budget.'),
      reasoning_effort: z.string().optional().describe('Optional reasoning effort string for supported models.'),
      top_p: z.number().min(0).max(1).optional().describe('Optional nucleus sampling value.'),
      system_instructions: z.string().optional().describe('Optional system instructions if supported by the chatbot integration.'),
      options: z.array(z.string()).optional().describe('Optional chatbot-specific option flags.'),
      raw_instructions: z.string().optional().describe('Original user instructions to preserve for CodeWebChat history/apply context.'),
      edit_format: z.string().optional().describe('Optional edit format metadata to preserve through Apply Response.'),
      prompt_type: z.string().optional().describe('Optional CodeWebChat prompt type value.'),
      reuse_last_tab: z.boolean().optional().describe('Reuse the last chatbot tab only when CodeWebChat reports that the previous response finished.'),
      invocation_count: z.number().int().positive().max(10).optional().describe('Open multiple chatbot invocations for the same prompt.'),
      timeout_ms: z.number().int().positive().max(900000).optional().describe('How long to wait for Apply Response. Default is 300000ms.')
    }
  },
  async (input) => {
    try {
      const response = await bridge.sendPromptAndWait(input)
      return {
        content: [
          {
            type: 'text',
            text: response
          }
        ]
      }
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: toErrorText(error)
          }
        ]
      }
    }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
```

## Example MCP tool call payload

```json
{
  "url": "https://claude.ai/new",
  "text": "You are reviewing an MCP prototype. Explain the smallest safe next step and return a TypeScript code example.",
  "system_instructions": "Be concise and focus on implementation details.",
  "reuse_last_tab": true,
  "timeout_ms": 300000
}
```

## Expected lifecycle

```text
MCP client calls send_to_codewebchat
  -> cwc-mcp-server connects to localhost:55155 as gemini-coder-vscode
  -> CodeWebChat assigns client_id
  -> cwc-mcp-server sends initialize-chat
  -> browser extension opens/fills chatbot
  -> user waits for chatbot response
  -> user clicks Apply Response
  -> browser extension copies response to clipboard
  -> browser extension sends apply-chat-response
  -> cwc-mcp-server reads clipboard
  -> MCP client receives raw response text
```
