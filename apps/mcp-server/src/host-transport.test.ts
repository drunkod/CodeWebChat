import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import WebSocket from 'ws'
import { CwcMcpError } from './errors.js'
import { HostTransport } from './host-transport.js'

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(
  condition: () => boolean,
  timeout = 2000
): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeout) {
      throw new Error('waitFor timed out')
    }
    await sleep(10)
  }
}

test('host mode: prompt reaches fake browser, apply response is forwarded', async () => {
  const host = new HostTransport({ port: 0 })
  const applyMessages: Array<Record<string, unknown>> = []
  host.onApplyResponse((message) => {
    applyMessages.push(message as Record<string, unknown>)
  })
  await host.connect()

  const browser = new WebSocket(
    `${host.address().replace('http', 'ws')}?token=gemini-coder`,
    {
      headers: {
        'user-agent': 'fake-browser'
      }
    }
  )
  const received: Array<{ action: string; [key: string]: unknown }> = []
  browser.on('message', (raw) => {
    received.push(
      JSON.parse(raw.toString()) as { action: string; [key: string]: unknown }
    )
  })
  await once(browser, 'open')

  host.sendInitializeChat({
    action: 'initialize-chat',
    client_id: 1,
    text: 'hello',
    url: 'https://example.com'
  })
  await waitFor(() =>
    received.some((message) => message.action === 'initialize-chat')
  )
  const init = received.find((message) => message.action === 'initialize-chat')
  assert.ok(init)
  assert.equal(init?.text, 'hello')

  browser.send(JSON.stringify({ action: 'apply-chat-response', client_id: 1 }))
  await waitFor(() => applyMessages.length === 1)

  await host.close()
  browser.close()
})

test('host mode: disconnect emits CWC_BROWSER_GONE', async () => {
  const host = new HostTransport({ port: 0 })
  const errors: unknown[] = []
  host.onClose((error) => {
    errors.push(error)
  })
  await host.connect()

  const browser = new WebSocket(
    `${host.address().replace('http', 'ws')}?token=gemini-coder`,
    {
      headers: {
        'user-agent': 'fake-browser'
      }
    }
  )
  await once(browser, 'open')
  browser.close()
  await sleep(50)

  assert.equal(errors.length > 0, true)
  assert.ok(errors[0] instanceof CwcMcpError)
  assert.equal((errors[0] as CwcMcpError).code, 'CWC_BROWSER_GONE')

  await host.close()
})

test('host mode: port already in use -> CWC_PORT_IN_USE', async () => {
  const a = new HostTransport({ port: 0 })
  await a.connect()
  const port = a.boundPort()
  const b = new HostTransport({ port })
  await assert.rejects(
    async () => b.connect(),
    (error: unknown) => {
      return error instanceof CwcMcpError && error.code === 'CWC_PORT_IN_USE'
    }
  )
  await a.close()
})
