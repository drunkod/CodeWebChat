#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readSystemClipboard } from './clipboard.js'
import { ClientTransport } from './client-transport.js'
import { RequestRegistry } from './request-registry.js'
import { toErrorText } from './errors.js'
import { CWC_MCP_INSTRUCTIONS } from './instructions.js'

const cwcTransport = new ClientTransport()
const registry = new RequestRegistry(cwcTransport, readSystemClipboard)

const server = new McpServer(
  {
    name: 'cwc-mcp-server',
    version: '0.1.0'
  },
  {
    instructions: CWC_MCP_INSTRUCTIONS
  }
)

server.registerTool(
  'cwc_status',
  {
    title: 'CodeWebChat Status',
    description:
      'Check whether the MCP server can connect to CodeWebChat and whether a browser extension is connected.',
    inputSchema: {}
  },
  async () => {
    try {
      await cwcTransport.connect()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(cwcTransport.status(), null, 2)
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

const sendInputSchema = {
  url: z
    .string()
    .url()
    .describe(
      'Target chatbot URL, such as https://claude.ai/new or https://chatgpt.com/.'
    ),
  text: z
    .string()
    .min(1)
    .describe('Prompt and code context to send to the chatbot.'),
  model: z
    .string()
    .optional()
    .describe(
      'Optional chatbot model name, if the selected CodeWebChat integration supports it.'
    ),
  target_browser_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Optional browser client ID when multiple browsers are connected.'
    ),
  temperature: z
    .number()
    .min(0)
    .max(2)
    .optional()
    .describe('Optional sampling temperature.'),
  thinking_budget: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional Claude thinking budget.'),
  reasoning_effort: z
    .string()
    .optional()
    .describe('Optional reasoning effort string for supported models.'),
  top_p: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Optional nucleus sampling value.'),
  system_instructions: z
    .string()
    .optional()
    .describe(
      'Optional system instructions if supported by the chatbot integration.'
    ),
  options: z
    .array(z.string())
    .optional()
    .describe('Optional chatbot-specific option flags.'),
  raw_instructions: z
    .string()
    .optional()
    .describe(
      'Original user instructions to preserve for CodeWebChat history/apply context.'
    ),
  edit_format: z
    .string()
    .optional()
    .describe(
      'Optional edit format metadata to preserve through Apply Response.'
    ),
  prompt_type: z
    .string()
    .optional()
    .describe('Optional CodeWebChat prompt type value.'),
  reuse_last_tab: z
    .boolean()
    .optional()
    .describe(
      'Reuse the last chatbot tab only when CodeWebChat reports that the previous response finished.'
    ),
  invocation_count: z
    .number()
    .int()
    .positive()
    .max(10)
    .optional()
    .describe('Open multiple chatbot invocations for the same prompt.'),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(900000)
    .optional()
    .describe('How long to wait for Apply Response. Default is 300000ms.')
}

server.registerTool(
  'send_to_codewebchat',
  {
    title: 'Send Prompt To CodeWebChat',
    description:
      'Send a prompt to CodeWebChat and return immediately with a ticket. Ask the user to click Apply Response, then call poll_cwc_response with that ticket.',
    inputSchema: sendInputSchema
  },
  async (input) => {
    try {
      const { ticket } = registry.begin(input)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'pending',
                ticket,
                next: 'Ask the user to click CodeWebChat Apply Response in the chatbot tab, then call poll_cwc_response with this ticket.'
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
  'poll_cwc_response',
  {
    title: 'Poll CodeWebChat Response',
    description:
      'Check whether the chatbot reply for a ticket is ready. Returns the reply when done, or status pending if the user has not clicked Apply Response yet.',
    inputSchema: {
      ticket: z
        .string()
        .min(1)
        .describe('Ticket returned by send_to_codewebchat.'),
      wait_ms: z
        .number()
        .int()
        .positive()
        .max(30000)
        .optional()
        .describe('Max time to wait this call (default 10000, cap 30000).')
    }
  },
  async ({ ticket, wait_ms }) => {
    try {
      const result = await registry.poll(ticket, wait_ms)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
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
