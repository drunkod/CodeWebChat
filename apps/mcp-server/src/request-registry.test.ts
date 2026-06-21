import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RequestRegistry } from './request-registry.js'
import type { ApplyChatResponseMessage } from './protocol.js'
import type { BridgeStatus, CwcTransport } from './transport.js'

class FakeTransport implements CwcTransport {
  public readonly mode = 'host' as const
  private applyHandler: (m: ApplyChatResponseMessage) => void = () => {}
  public responseText = ''

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
        response_text: this.responseText
      })
    })
  }

  async close(): Promise<void> {}
}

test('blank inline response_text falls back to clipboard when clipboard fallback is enabled', async () => {
  let reads = 0
  const transport = new FakeTransport()
  transport.responseText = ''
  const registry = new RequestRegistry(
    transport,
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
  const transport = new FakeTransport()
  transport.responseText = ''
  const registry = new RequestRegistry(
    transport,
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

test('non-blank inline response_text is returned directly and the clipboard is never used as the response source', async () => {
  // The registry reads the clipboard once up front to capture a staleness
  // baseline (it must snapshot before the browser copies). On the inline path
  // that baseline is discarded and the inline text is returned. So the
  // guarantee is "clipboard is never the response source", NOT "never read".
  const CLIPBOARD_SENTINEL = 'CLIPBOARD-DATA-MUST-NOT-BE-RETURNED'
  let clipboardReads = 0
  const transport = new FakeTransport()
  transport.responseText = 'my inline reply text'
  const registry = new RequestRegistry(
    transport,
    async () => {
      clipboardReads += 1
      return CLIPBOARD_SENTINEL
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
    response: 'my inline reply text'
  })
  // The inline text won, not the clipboard value.
  assert.notEqual(result.response, CLIPBOARD_SENTINEL)
  // At most the single baseline snapshot — never the post-Apply fallback read.
  assert.ok(
    clipboardReads <= 1,
    `clipboard should not be read as the fallback on the inline path (reads=${clipboardReads})`
  )
})
