# Step 6 — Upgrade the Protocol for V1

## Goal

Remove the two biggest V0 limitations:

1. Clipboard dependence.
2. Request correlation by `client_id` only.

The research answers show that `client_id` identifies the editor connection, not an individual request. That is fine for serialized V0 usage, but unsafe for concurrent tool calls. V1 should add a `request_id` and allow the browser extension to send `response_text` directly in `apply-chat-response`.

## V1 protocol design

```text
MCP tool call
  -> generate request_id
  -> send initialize-chat with request_id
  -> browser stores request_id with chat initialization data
  -> user clicks Apply Response
  -> browser extracts response text
  -> browser sends apply-chat-response with request_id and response_text
  -> MCP bridge resolves the matching request without reading clipboard
```

## Complete shared type change

Update the shared WebSocket message types.

### File: `packages/shared/src/types/websocket-message.ts`

```ts
import type { WebPromptType } from './web-prompt-type'

export type InitializeChatMessage = {
  action: 'initialize-chat'
  text: string
  url: string
  client_id: number

  /**
   * V1: Correlates one prompt with one response.
   * This is required because client_id identifies the editor/MCP connection,
   * not the individual request.
   */
  request_id?: string

  model?: string
  target_browser_id?: number
  temperature?: number
  thinking_budget?: number
  reasoning_effort?: string
  top_p?: number
  system_instructions?: string
  options?: string[]
  raw_instructions?: string
  edit_format?: string
  prompt_type?: WebPromptType
  reuse_last_tab?: boolean
  invocation_count?: number
}

export type ApplyChatResponseMessage = {
  action: 'apply-chat-response'
  client_id: number

  /**
   * V1: Echoes InitializeChatMessage.request_id.
   * Optional for backward compatibility with existing clients.
   */
  request_id?: string

  /**
   * V1: Raw response text extracted by the browser extension.
   * Optional for backward compatibility with the existing clipboard flow.
   */
  response_text?: string

  raw_instructions?: string
  edit_format?: string
  url?: string
}
```

## Complete browser-side helper

Add a helper that extracts the response text and keeps the clipboard behavior for backward compatibility.

### File: `apps/browser/src/content-scripts/send-prompt-content-script/utils/send-apply-response.ts`

```ts
import browser from 'webextension-polyfill'
import type { Message } from '../../../types/messages'

type SendApplyResponseParams = {
  client_id: number
  request_id?: string
  raw_instructions?: string
  edit_format?: string
  footer: HTMLElement
  perform_copy: (footer: HTMLElement) => Promise<void>
  extract_response_text: () => string | Promise<string>
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export const send_apply_response = async (params: SendApplyResponseParams): Promise<void> => {
  const response_text = await params.extract_response_text()

  // Preserve existing CodeWebChat behavior so VS Code users are not broken.
  await params.perform_copy(params.footer)

  // Existing implementation waits before sending the signal so clipboard writes settle.
  await sleep(500)

  await browser.runtime.sendMessage<Message>({
    action: 'apply-chat-response',
    client_id: params.client_id,
    request_id: params.request_id,
    response_text,
    raw_instructions: params.raw_instructions,
    edit_format: params.edit_format,
    url: window.location.href
  })
}
```

## Complete content-script integration example

Update the Apply Response button handler to call the new helper.

### File: `apps/browser/src/content-scripts/send-prompt-content-script/utils/add-apply-response-button.ts`

```ts
import { send_apply_response } from './send-apply-response'

type AddApplyResponseButtonParams = {
  footer: HTMLElement
  client_id: number
  request_id?: string
  raw_instructions?: string
  edit_format?: string
  perform_copy: (footer: HTMLElement) => Promise<void>
  extract_response_text: () => string | Promise<string>
}

const set_button_disabled_state = (button: HTMLButtonElement): void => {
  button.disabled = true
  button.textContent = 'Applying...'
}

export const add_apply_response_button = (params: AddApplyResponseButtonParams): HTMLButtonElement => {
  const apply_response_button = document.createElement('button')
  apply_response_button.type = 'button'
  apply_response_button.textContent = 'Apply Response'
  apply_response_button.dataset.cwcApplyResponse = 'true'

  apply_response_button.addEventListener('click', async () => {
    set_button_disabled_state(apply_response_button)

    requestAnimationFrame(() => {
      void send_apply_response({
        footer: params.footer,
        client_id: params.client_id,
        request_id: params.request_id,
        raw_instructions: params.raw_instructions,
        edit_format: params.edit_format,
        perform_copy: params.perform_copy,
        extract_response_text: params.extract_response_text
      }).finally(() => {
        apply_response_button.disabled = false
        apply_response_button.textContent = 'Apply Response'
      })
    })
  })

  params.footer.appendChild(apply_response_button)
  return apply_response_button
}
```

## Complete generic response extractor example

This extractor should be adapted per chatbot if necessary, but it gives the extension a generic fallback.

### File: `apps/browser/src/content-scripts/send-prompt-content-script/utils/extract-response-text.ts`

```ts
const cloneWithoutCwcButtons = (element: HTMLElement): HTMLElement => {
  const clone = element.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[data-cwc-apply-response="true"]').forEach((node) => node.remove())
  return clone
}

export const extract_response_text_from_footer = (footer: HTMLElement): string => {
  const candidate = footer.closest('article, [data-testid*="conversation"], [class*="message"], [class*="response"]')

  if (candidate instanceof HTMLElement) {
    const clone = cloneWithoutCwcButtons(candidate)
    const text = clone.innerText.trim()
    if (text) return text
  }

  const fallback = cloneWithoutCwcButtons(footer).innerText.trim()
  return fallback
}
```

## Complete MCP bridge V1 request handling example

This replaces the single pending response slot with a request map. It also prefers `response_text` and only falls back to the clipboard for backward compatibility.

### File: `apps/mcp-server/src/cwc-bridge-v1.ts`

```ts
import crypto from 'node:crypto'
import WebSocket from 'ws'
import { CwcMcpError } from './errors.js'
import type { ReadClipboard } from './clipboard.js'
import {
  DEFAULT_CWC_PORT,
  SECURITY_TOKENS,
  type ApplyChatResponseMessage,
  type InitializeChatMessage
} from './protocol.js'

type SendPromptInput = Omit<InitializeChatMessage, 'action' | 'client_id' | 'request_id'> & {
  timeout_ms?: number
}

type PendingRequest = {
  client_id: number
  before_clipboard: string
  resolve: (value: string) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class CwcBridgeV1 {
  private ws: WebSocket | null = null
  private client_id: number | null = null
  private browser_connected = false
  private pending_requests = new Map<string, PendingRequest>()

  constructor(
    private readonly options: {
      read_clipboard: ReadClipboard
      ws_url?: string
      vscode_token?: string
      connect_timeout_ms?: number
      clipboard_read_delay_ms?: number
    }
  ) {}

  public async sendPromptAndWait(input: SendPromptInput): Promise<string> {
    await this.connect()

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new CwcMcpError('Not connected to CodeWebChat.', 'CWC_NOT_CONNECTED')
    }

    if (this.client_id === null) {
      throw new CwcMcpError('No client_id assigned by CodeWebChat.', 'CWC_NO_CLIENT_ID')
    }

    if (!this.browser_connected) {
      throw new CwcMcpError('No browser extension is connected.', 'CWC_NO_BROWSER')
    }

    const request_id = crypto.randomUUID()
    const before_clipboard = await this.options.read_clipboard()
    const timeout_ms = input.timeout_ms ?? 300000

    const result = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending_requests.delete(request_id)
        reject(new CwcMcpError(`Timed out waiting for request ${request_id}.`, 'CWC_TIMEOUT'))
      }, timeout_ms)

      this.pending_requests.set(request_id, {
        client_id: this.client_id!,
        before_clipboard,
        resolve,
        reject,
        timer
      })
    })

    const message: InitializeChatMessage = {
      ...input,
      action: 'initialize-chat',
      client_id: this.client_id,
      request_id
    }

    this.ws.send(JSON.stringify(message))
    return await result
  }

  private async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN && this.client_id !== null) return

    const base_url = this.options.ws_url ?? `ws://localhost:${DEFAULT_CWC_PORT}`
    const token = this.options.vscode_token ?? SECURITY_TOKENS.VSCODE
    const url = new URL(base_url)
    url.searchParams.set('token', token)
    url.searchParams.set('vscode_extension_version', 'cwc-mcp-server-v1')

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url.toString())
      this.ws = ws

      const timer = setTimeout(() => reject(new CwcMcpError('Timed out connecting to CodeWebChat.', 'CWC_NOT_CONNECTED')), this.options.connect_timeout_ms ?? 3000)

      ws.on('open', () => {
        clearTimeout(timer)
        resolve()
      })

      ws.on('error', reject)
      ws.on('close', () => {
        this.ws = null
        this.client_id = null
        this.browser_connected = false
        for (const [request_id, pending] of this.pending_requests) {
          clearTimeout(pending.timer)
          pending.reject(new CwcMcpError(`Connection closed before request ${request_id} completed.`, 'CWC_NOT_CONNECTED'))
        }
        this.pending_requests.clear()
      })

      ws.on('message', (raw) => {
        void this.handleMessage(raw.toString())
      })
    })

    const started = Date.now()
    while (this.client_id === null) {
      if (Date.now() - started > (this.options.connect_timeout_ms ?? 3000)) {
        throw new CwcMcpError('Connected but did not receive client-id-assignment.', 'CWC_NO_CLIENT_ID')
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  private async handleMessage(raw: string): Promise<void> {
    const message = JSON.parse(raw) as Record<string, unknown>

    if (message.action === 'client-id-assignment') {
      this.client_id = Number(message.client_id)
      return
    }

    if (message.action === 'browser-connection-status') {
      this.browser_connected = Boolean(message.has_connected_browsers)
      return
    }

    if (message.action === 'apply-chat-response') {
      await this.handleApplyResponse(message as ApplyChatResponseMessage)
    }
  }

  private async handleApplyResponse(message: ApplyChatResponseMessage): Promise<void> {
    if (!message.request_id) {
      // Backward-compatible fallback: only safe if exactly one request is pending.
      if (this.pending_requests.size !== 1) return
      const only_request_id = [...this.pending_requests.keys()][0]
      await this.resolveRequestFromClipboard(only_request_id)
      return
    }

    const pending = this.pending_requests.get(message.request_id)
    if (!pending) return
    if (pending.client_id !== message.client_id) return

    clearTimeout(pending.timer)
    this.pending_requests.delete(message.request_id)

    if (message.response_text?.trim()) {
      pending.resolve(message.response_text)
      return
    }

    await this.resolveRequestFromClipboard(message.request_id, pending)
  }

  private async resolveRequestFromClipboard(request_id: string, existing?: PendingRequest): Promise<void> {
    const pending = existing ?? this.pending_requests.get(request_id)
    if (!pending) return

    await new Promise((resolve) => setTimeout(resolve, this.options.clipboard_read_delay_ms ?? 250))
    const clipboard_text = await this.options.read_clipboard()

    clearTimeout(pending.timer)
    this.pending_requests.delete(request_id)

    if (!clipboard_text.trim()) {
      pending.reject(new CwcMcpError('Clipboard was empty.', 'CWC_CLIPBOARD_EMPTY'))
      return
    }

    if (clipboard_text === pending.before_clipboard) {
      pending.reject(new CwcMcpError('Clipboard did not change.', 'CWC_CLIPBOARD_UNCHANGED'))
      return
    }

    pending.resolve(clipboard_text)
  }
}
```

## V1 acceptance criteria

```text
[ ] InitializeChatMessage supports optional request_id.
[ ] ApplyChatResponseMessage supports optional request_id.
[ ] ApplyChatResponseMessage supports optional response_text.
[ ] Existing VS Code clipboard flow still works.
[ ] MCP server prefers response_text over clipboard.
[ ] Concurrent MCP requests are either supported with request_id or explicitly rejected.
[ ] Tests cover V0 fallback and V1 response_text path.
```
