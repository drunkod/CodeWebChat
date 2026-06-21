#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readSystemClipboard } from './clipboard.js'
import { ClientTransport } from './client-transport.js'
import { HostTransport } from './host-transport.js'
import { RequestRegistry } from './request-registry.js'
import { ReviewHandoff } from './review-handoff.js'
import { realGitRunner, DEFAULT_REVIEW_FOCUS } from './git-context.js'
import { toErrorText } from './errors.js'
import { CWC_MCP_INSTRUCTIONS } from './instructions.js'

const args = process.argv.slice(2)
const modeArgIndex = args.findIndex((arg) => arg === '--mode')
const mode = modeArgIndex >= 0 ? args[modeArgIndex + 1] : 'client'

const cwcTransport =
  mode === 'host' ? new HostTransport() : new ClientTransport()
const registry = new RequestRegistry(cwcTransport, readSystemClipboard)
const reviewHandoff = new ReviewHandoff(registry, realGitRunner)

const instructions = `${CWC_MCP_INSTRUCTIONS} Operating mode: ${cwcTransport.mode}. ${
  cwcTransport.mode === 'host'
    ? 'This server hosts the relay on port 55155 and expects browser clients to connect directly.'
    : 'This server connects to the existing CodeWebChat VS Code relay.'
}`

const server = new McpServer(
  {
    name: 'cwc-mcp-server',
    version: '0.1.0'
  },
  {
    instructions
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
  url: z.string().url().describe('Target chatbot URL.'),
  text: z
    .string()
    .min(1)
    .describe('Prompt and code context to send to the chatbot.'),
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
        .describe('Max time to wait this call.')
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

// ---- v1: dedicated review-handoff tools -------------------------------------

const reviewPrepareSchema = {
  base_branch: z
    .string()
    .optional()
    .describe('Trunk to diff against. Default "main".'),
  review_focus: z
    .string()
    .optional()
    .describe(
      `What the reviewer should focus on. Default: ${DEFAULT_REVIEW_FOCUS}`
    ),
  summary: z
    .string()
    .optional()
    .describe('Author summary of the change. Defaults to the commit body.'),
  repo_path: z
    .string()
    .optional()
    .describe('Absolute path to the git repo. Default: server cwd.'),
  push: z
    .boolean()
    .optional()
    .describe(
      'Push the branch first so the reviewer can fetch it. Default true.'
    )
}

server.registerTool(
  'prepare_review_handoff',
  {
    title: 'Prepare Review Handoff',
    description:
      'Gather git metadata (repo, branch, remote commit SHA, changed files) and return the filled review-handoff prompt. Does not send anything.',
    inputSchema: reviewPrepareSchema
  },
  async (input) => {
    try {
      const result = await reviewHandoff.prepare(input)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
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
  'request_review',
  {
    title: 'Request Code Review',
    description:
      'Gather git metadata, build the handoff prompt, and send it to a GitHub-connected ChatGPT page. Returns a ticket immediately; ask the user to click Apply Response, then call import_review_feedback with the ticket.',
    inputSchema: {
      chatgpt_url: z
        .string()
        .url()
        .describe('URL of the GitHub-connected ChatGPT project page.'),
      ...reviewPrepareSchema,
      timeout_ms: z.number().int().positive().max(900000).optional()
    }
  },
  async (input) => {
    try {
      const result = await reviewHandoff.requestReview(input)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'pending',
                ticket: result.ticket,
                reviewed_sha: result.reviewed_sha,
                packet: result.packet,
                next: 'Ask the user to click CodeWebChat Apply Response in the ChatGPT tab, then call import_review_feedback with this ticket.'
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
  'import_review_feedback',
  {
    title: 'Import Review Feedback',
    description:
      'Poll a review ticket. When the review is ready, return the parsed verdict/findings/tests/patch-plan plus a "stale" flag if the branch HEAD has drifted from the reviewed commit. Returns status pending if the user has not clicked Apply Response yet.',
    inputSchema: {
      ticket: z.string().min(1).describe('Ticket from request_review.'),
      wait_ms: z.number().int().positive().max(30000).optional()
    }
  },
  async ({ ticket, wait_ms }) => {
    try {
      const result = await reviewHandoff.importFeedback(ticket, wait_ms)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: toErrorText(error) }]
      }
    }
  }
)

const stdio = new StdioServerTransport()
await server.connect(stdio)
