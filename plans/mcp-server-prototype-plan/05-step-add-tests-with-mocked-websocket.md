# Step 5 — Add Tests with a Mocked WebSocket Server

## Goal

Test the MCP bridge without launching VS Code or a real browser extension.

The research notes show that the CodeWebChat WebSocket server is a standalone Node process, but the browser content-script path is harder to mock end-to-end. For V0, unit-test the MCP bridge with a mocked WebSocket server and mocked clipboard reader.

## What this test covers

1. The bridge connects as an editor-role client.
2. The mock server sends `client-id-assignment`.
3. The mock server sends `browser-connection-status`.
4. The bridge sends `initialize-chat`.
5. The mock server sends `apply-chat-response`.
6. The bridge reads the mocked clipboard and returns the response.
7. The test verifies the prompt payload sent to the server.

## Complete file: `apps/mcp-server/test/cwc-bridge.test.ts`

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { CwcBridge } from '../src/cwc-bridge.js'
import { SECURITY_TOKENS, type InitializeChatMessage } from '../src/protocol.js'

const createMockCwcServer = async () => {
  const http_server = http.createServer()
  const ws_server = new WebSocketServer({ server: http_server })
  const received_initialize_messages: InitializeChatMessage[] = []

  await new Promise<void>((resolve) => {
    http_server.listen(0, '127.0.0.1', resolve)
  })

  const address = http_server.address()
  assert.ok(address && typeof address === 'object')

  ws_server.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
    const token = url.searchParams.get('token')

    if (token !== SECURITY_TOKENS.VSCODE) {
      socket.close(1008, 'invalid token')
      return
    }

    socket.send(
      JSON.stringify({
        action: 'client-id-assignment',
        client_id: 7
      })
    )

    socket.send(
      JSON.stringify({
        action: 'browser-connection-status',
        has_connected_browsers: true,
        connected_browsers: [{ id: 1, name: 'Mock Browser' }]
      })
    )

    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as InitializeChatMessage
      if (message.action !== 'initialize-chat') return

      received_initialize_messages.push(message)

      socket.send(
        JSON.stringify({
          action: 'apply-chat-response',
          client_id: message.client_id,
          raw_instructions: message.raw_instructions,
          edit_format: message.edit_format,
          url: 'https://claude.ai/new/mock-response'
        })
      )
    })
  })

  return {
    ws_url: `ws://127.0.0.1:${address.port}`,
    received_initialize_messages,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        ws_server.close((ws_error) => {
          if (ws_error) reject(ws_error)
          else resolve()
        })
      })

      await new Promise<void>((resolve, reject) => {
        http_server.close((http_error) => {
          if (http_error) reject(http_error)
          else resolve()
        })
      })
    }
  }
}

test('CwcBridge sends initialize-chat and returns clipboard text after apply-chat-response', async () => {
  const mock = await createMockCwcServer()
  let clipboard_value = 'before'

  const bridge = new CwcBridge({
    ws_url: mock.ws_url,
    read_clipboard: async () => clipboard_value,
    clipboard_read_delay_ms: 0
  })

  try {
    await bridge.connect()

    assert.deepEqual(bridge.status(), {
      websocket_connected: true,
      client_id: 7,
      browser_connected: true,
      connected_browser_count: 1
    })

    clipboard_value = '```ts\nexport const answer = 42\n```'

    const response = await bridge.sendPromptAndWait({
      url: 'https://claude.ai/new',
      text: 'Return a TypeScript constant named answer.',
      system_instructions: 'Return only code.',
      raw_instructions: 'Create a tiny code example.',
      edit_format: 'raw',
      reuse_last_tab: true,
      timeout_ms: 1000
    })

    assert.equal(response, '```ts\nexport const answer = 42\n```')
    assert.equal(mock.received_initialize_messages.length, 1)

    assert.deepEqual(mock.received_initialize_messages[0], {
      action: 'initialize-chat',
      text: 'Return a TypeScript constant named answer.',
      url: 'https://claude.ai/new',
      client_id: 7,
      system_instructions: 'Return only code.',
      raw_instructions: 'Create a tiny code example.',
      edit_format: 'raw',
      reuse_last_tab: true
    })
  } finally {
    await mock.close()
  }
})

test('CwcBridge rejects unchanged clipboard content', async () => {
  const mock = await createMockCwcServer()

  const bridge = new CwcBridge({
    ws_url: mock.ws_url,
    read_clipboard: async () => 'same clipboard value',
    clipboard_read_delay_ms: 0
  })

  try {
    await bridge.connect()

    await assert.rejects(
      bridge.sendPromptAndWait({
        url: 'https://claude.ai/new',
        text: 'Return anything.',
        timeout_ms: 1000
      }),
      /clipboard did not change/i
    )
  } finally {
    await mock.close()
  }
})
```

## Complete optional file: `apps/mcp-server/test/no-browser.test.ts`

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { CwcBridge } from '../src/cwc-bridge.js'
import { SECURITY_TOKENS } from '../src/protocol.js'

const createNoBrowserServer = async () => {
  const http_server = http.createServer()
  const ws_server = new WebSocketServer({ server: http_server })

  await new Promise<void>((resolve) => {
    http_server.listen(0, '127.0.0.1', resolve)
  })

  const address = http_server.address()
  assert.ok(address && typeof address === 'object')

  ws_server.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
    const token = url.searchParams.get('token')

    if (token !== SECURITY_TOKENS.VSCODE) {
      socket.close(1008, 'invalid token')
      return
    }

    socket.send(JSON.stringify({ action: 'client-id-assignment', client_id: 3 }))
    socket.send(
      JSON.stringify({
        action: 'browser-connection-status',
        has_connected_browsers: false,
        connected_browsers: []
      })
    )
  })

  return {
    ws_url: `ws://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve) => ws_server.close(() => resolve()))
      await new Promise<void>((resolve) => http_server.close(() => resolve()))
    }
  }
}

test('CwcBridge rejects send when no browser extension is connected', async () => {
  const mock = await createNoBrowserServer()
  const bridge = new CwcBridge({
    ws_url: mock.ws_url,
    read_clipboard: async () => 'unused'
  })

  try {
    await bridge.connect()

    await assert.rejects(
      bridge.sendPromptAndWait({
        url: 'https://claude.ai/new',
        text: 'This should not send.',
        timeout_ms: 1000
      }),
      /No CodeWebChat browser extension is connected/i
    )
  } finally {
    await mock.close()
  }
})
```

## Run tests

```bash
cd apps/mcp-server
npm test
```

## Expected result

```text
✔ CwcBridge sends initialize-chat and returns clipboard text after apply-chat-response
✔ CwcBridge rejects unchanged clipboard content
✔ CwcBridge rejects send when no browser extension is connected
```

## Why this is enough for V0

These tests validate the MCP server's contract with the existing CodeWebChat protocol without relying on a real chatbot, real browser automation, or real clipboard state. The browser/content-script path should be covered by a separate manual integration checklist because chatbot DOMs and browser-extension state are inherently environment-dependent.
