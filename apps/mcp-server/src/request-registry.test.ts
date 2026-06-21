import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RequestRegistry } from './request-registry.js'
import type { ApplyChatResponseMessage } from './protocol.js'
import type { BridgeStatus, CwcTransport } from './transport.js'

class FakeTransport implements CwcTransport {
  public readonly mode = 'host' as const
  private applyHandler: (m: ApplyChatResponseMessage) => void = () => {}

  onApplyResponse(handler: (m: ApplyChatResponseMessage) => void): void {
    this.applyHandler = handler
  }

  onClose(): void {}

  async connect(): Promise<void> {}

  async ensureReady(): Promise<void> {}

  status(): BridgeStatus {
    return {
      mode: 'host',
      hosting: true,
      websocket_connected: true,
      browser_connected: true,
      connected_browser_count: 1,
      client_id: 1
    }
  }

  sendInitializeChat(): void {
    queueMicrotask(() => {
      this.applyHandler({
        action: 'apply-chat-response',
        client_id: 1,
        response_text: ''
      })
    })
  }

  async close(): Promise<void> {}
}

test('blank inline response_text falls back to clipboard when clipboard fallback is enabled', async () => {
  let reads = 0
  const registry = new RequestRegistry(
    new FakeTransport(),
    async () => {
      reads += 1
      return reads === 1 ? 'old clipboard' : 'new clipboard reply'
    },
    {
      clipboard_read_delay_ms: 0,
      use_clipboard_fallback: true
    }
  )

  const { ticket } = registry.begin({
    url: 'https://chatgpt.com/',
    text: 'hello'
  })

  const result = await registry.poll(ticket, 1000)

  assert.deepEqual(result, {
    status: 'done',
    response: 'new clipboard reply'
  })
})

test('blank inline response_text fails when clipboard fallback is disabled', async () => {
  const registry = new RequestRegistry(
    new FakeTransport(),
    async () => 'clipboard should not be read',
    {
      clipboard_read_delay_ms: 0,
      use_clipboard_fallback: false
    }
  )

  const { ticket } = registry.begin({
    url: 'https://chatgpt.com/',
    text: 'hello'
  })

  await assert.rejects(
    async () => registry.poll(ticket, 1000),
    /CWC_RESPONSE_TEXT_MISSING|response_text/
  )
})
