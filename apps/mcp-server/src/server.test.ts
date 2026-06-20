import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// Integration tests over the real stdio transport.
// Spawns the compiled server (dist/index.js, sibling of this file) using the
// SAME node binary that runs the tests, then drives it with the official MCP
// SDK client. No CodeWebChat / VS Code / browser required: listing tools and
// validating arguments happen entirely inside the MCP handshake.

const serverPath = fileURLToPath(new URL('./index.js', import.meta.url))

let client: Client
let transport: StdioClientTransport

before(async () => {
  transport = new StdioClientTransport({
    command: process.execPath, // the node running these tests — avoids PATH issues
    args: [serverPath]
  })
  client = new Client(
    { name: 'cwc-test-client', version: '1.0.0' },
    { capabilities: {} }
  )
  await client.connect(transport)
})

after(async () => {
  await transport.close()
})

// Accept either failure shape: a rejected promise OR an isError result.
async function expectToolFailure(
  name: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const res = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean
    }
    assert.equal(
      res.isError,
      true,
      `expected ${name} to report isError for ${JSON.stringify(args)}`
    )
  } catch {
    // Threw at the protocol level (-32602 invalid params) — also acceptable.
  }
}

test('lists the expected tools', async () => {
  const { tools } = await client.listTools()
  const names = tools.map((t) => t.name)
  assert.ok(
    names.includes('cwc_status'),
    `missing cwc_status; got ${names.join(', ')}`
  )
  assert.ok(
    names.includes('send_to_codewebchat'),
    `missing send_to_codewebchat; got ${names.join(', ')}`
  )
  assert.ok(
    names.includes('poll_cwc_response'),
    `missing poll_cwc_response; got ${names.join(', ')}`
  )
})

test('poll_cwc_response on an unknown ticket reports an error', async () => {
  await expectToolFailure('poll_cwc_response', { ticket: 'does-not-exist' })
})

test('send_to_codewebchat declares url and text as required', async () => {
  const { tools } = await client.listTools()
  const send = tools.find((t) => t.name === 'send_to_codewebchat')
  assert.ok(send, 'send_to_codewebchat not found')
  const required = (send!.inputSchema as { required?: string[] }).required ?? []
  assert.ok(required.includes('url'), 'url should be required')
  assert.ok(required.includes('text'), 'text should be required')
})

test('send_to_codewebchat rejects missing required text', async () => {
  await expectToolFailure('send_to_codewebchat', {
    url: 'https://claude.ai/new'
  })
})

test('send_to_codewebchat rejects an invalid url', async () => {
  await expectToolFailure('send_to_codewebchat', {
    url: 'not-a-url',
    text: 'hi'
  })
})

test('cwc_status executes and returns a text result', async () => {
  // We do NOT assert connected/disconnected — that depends on whether the
  // CodeWebChat WebSocket server happens to be running. We only assert the tool
  // runs and returns a well-formed text payload.
  const res = (await client.callTool({
    name: 'cwc_status',
    arguments: {}
  })) as {
    content?: Array<{ type: string; text?: string }>
  }
  assert.ok(Array.isArray(res.content), 'content should be an array')
  assert.equal(res.content?.[0]?.type, 'text')
  assert.equal(typeof res.content?.[0]?.text, 'string')
})
