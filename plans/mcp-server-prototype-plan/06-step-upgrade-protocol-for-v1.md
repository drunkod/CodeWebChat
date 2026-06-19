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
  -> browser extracts response text from DOM (per-chatbot)
  -> browser sends apply-chat-response with request_id and response_text
  -> MCP bridge resolves the matching request without reading clipboard
```

---

## File 1: `packages/shared/src/types/websocket-message.ts`

Add optional `request_id` and `response_text` to both message types. Both fields are optional for full backward compatibility with existing VS Code clients that do not send or consume them.

```ts
import type { WebPromptType } from './web-prompt-type'

export type InitializeChatMessage = {
  action: 'initialize-chat'
  text: string
  url: string
  client_id: number

  /**
   * V1: Correlates one prompt with one response.
   * Required for concurrent MCP tool calls — client_id alone identifies
   * the connection, not the individual request.
   * Optional for backward compatibility with existing VS Code clients.
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
   * When present, the MCP bridge uses this instead of the OS clipboard.
   * Optional for backward compatibility with the existing clipboard flow.
   */
  response_text?: string

  raw_instructions?: string
  edit_format?: string
  url?: string
}
```

---

## File 2: `apps/browser/src/types/messages.ts`

The browser extension's internal `Message` union type must be updated to include `request_id` and `response_text`. Without this change, TypeScript will error when the content script tries to send the new fields via `browser.runtime.sendMessage<Message>(...)`.

```ts
type ChatInitializedMessage = {
  action: 'chat-initialized'
}

type ApplyChatResponseMessage = {
  action: 'apply-chat-response'
  client_id: number
  /**
   * V1: echoes the request_id from InitializeChatMessage.
   * Undefined for responses triggered by existing VS Code clients.
   */
  request_id?: string
  /**
   * V1: response text extracted from the chatbot DOM.
   * Undefined when triggered by existing VS Code clients (clipboard path).
   */
  response_text?: string
  raw_instructions?: string
  edit_format?: string
  url?: string
}

type FinishedRespondingMessage = {
  action: 'finished-responding'
}

export type Message =
  | ChatInitializedMessage
  | ApplyChatResponseMessage
  | FinishedRespondingMessage
```

---

## File 3: `apps/browser/src/content-scripts/send-prompt-content-script/utils/add-apply-response-button.ts`

Add `request_id` and `extract_response_text` parameters to the existing `add_apply_response_button` function. Both are optional so all 20+ existing chatbot integrations continue to compile and work unchanged — they simply don't pass the new params and fall back to the clipboard path.

```ts
import { Message } from '@/types/messages'
import { Logger } from '@shared/utils/logger'
import browser from 'webextension-polyfill'
import { apply_response_icon } from '../constants/apply-response-icon'
import { apply_response_button_title } from '../constants/dictionary'
import {
  apply_chat_response_button_style,
  set_button_disabled_state
} from './apply-response-styles'
import { show_response_ready_notification } from './show-response-ready-notification'

export function add_apply_response_button(params: {
  client_id: number
  /**
   * V1: optional. When provided, echoed in apply-chat-response so the
   * MCP bridge can correlate responses without relying on client_id alone.
   */
  request_id?: string
  raw_instructions?: string
  edit_format?: string
  footer: Element
  get_chat_turn: (footer: Element) => HTMLElement | null
  get_code_from_block?: (code_block: Element) => string | null | undefined
  perform_copy: (footer: Element) => void | Promise<void>
  /**
   * V1: optional. When provided, called to extract the chatbot response text
   * from the DOM. The returned text is sent as response_text in the
   * apply-chat-response message so the MCP bridge can skip the clipboard.
   * When absent, the MCP bridge falls back to the OS clipboard (V0 path).
   */
  extract_response_text?: (footer: Element) => string | Promise<string>
  insert_button: (footer: Element, button: HTMLButtonElement) => void
  customize_button?: (button: HTMLButtonElement) => void
}) {
  const existing_apply_response_button = params.footer.querySelector(
    '.cwc-apply-response-button'
  )

  if (existing_apply_response_button) return

  const chat_turn = params.get_chat_turn(params.footer)
  if (!chat_turn) {
    Logger.error({
      function_name: 'add_apply_response_button',
      message: 'Chat turn container not found',
      data: params.footer
    })
    return
  }

  const apply_response_button = document.createElement('button')
  apply_response_button.innerHTML = apply_response_icon
  apply_response_button.classList.add('cwc-apply-response-button')
  apply_response_button.title = apply_response_button_title
  apply_chat_response_button_style(apply_response_button)
  if (params.customize_button) params.customize_button(apply_response_button)

  apply_response_button.addEventListener('click', async () => {
    set_button_disabled_state(apply_response_button)
    requestAnimationFrame(async () => {
      // V1: extract text before perform_copy so the DOM is still intact
      const response_text = params.extract_response_text
        ? await params.extract_response_text(params.footer)
        : undefined

      // Always run perform_copy to preserve the existing clipboard behavior
      // for VS Code users who rely on it
      await params.perform_copy(params.footer)
      await new Promise((resolve) => setTimeout(resolve, 500))

      browser.runtime.sendMessage<Message>({
        action: 'apply-chat-response',
        client_id: params.client_id,
        request_id: params.request_id,
        response_text,
        raw_instructions: params.raw_instructions,
        edit_format: params.edit_format,
        url: window.location.href
      })
    })
  })

  params.insert_button(params.footer, apply_response_button)
}
```

---

## File 4: per-chatbot `extract_response_text` implementations

> **Scope note:** Each chatbot has a different DOM. A generic selector heuristic is unreliable — `[class*="message"]` breaks on nearly every production chatbot DOM. Each chatbot integration under `apps/browser/src/content-scripts/send-prompt-content-script/chatbots/` needs its own implementation. Below are concrete examples for the three primary chatbots. Remaining chatbots should be done in follow-up PRs, verified manually against live chatbot sessions.

### Claude (`chatbots/claude.ts`)

Claude wraps each response in a `.group` div. `get_chat_turn` already locates it via `f.closest('.group')`. Use the same anchor.

```ts
// Inside claude.ts — update the add_apply_response_button call:
add_apply_response_button({
  client_id: params.client_id,
  request_id: params.request_id,   // V1: pass through from initialize-chat
  raw_instructions: params.raw_instructions,
  edit_format: params.edit_format,
  footer,
  get_chat_turn: (f) => f.closest('.group'),
  perform_copy: (f) => {
    const copy_button = f.querySelector(
      'button[data-testid="action-bar-copy"]'
    ) as HTMLElement
    if (!copy_button) {
      report_initialization_error({
        function_name: 'claude.perform_copy',
        log_message: 'Copy button not found'
      })
      return
    }
    copy_button.click()
  },
  // V1: extract the response text from the DOM before perform_copy fires
  extract_response_text: (f) => {
    const chat_turn = f.closest('.group') as HTMLElement | null
    if (!chat_turn) return ''
    // Claude renders responses in div.font-claude-message > div[data-is-streaming="false"]
    const response_container = chat_turn.querySelector(
      'div[data-is-streaming="false"]'
    ) as HTMLElement | null
    if (response_container) return response_container.innerText.trim()
    // Fallback: innerText of the whole chat turn minus our button
    const clone = chat_turn.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.cwc-apply-response-button').forEach((n) => n.remove())
    return clone.innerText.trim()
  },
  insert_button: (f, b) =>
    f.insertBefore(b, f.children[f.children.length])
})
```

### ChatGPT (`chatbots/chatgpt.ts`)

ChatGPT renders assistant messages in `article[data-testid^="conversation-turn"]`. Each footer is inside the article.

```ts
// Inside chatgpt.ts — update the add_apply_response_button call:
add_apply_response_button({
  client_id: params.client_id,
  request_id: params.request_id,
  raw_instructions: params.raw_instructions,
  edit_format: params.edit_format,
  footer,
  get_chat_turn: (f) =>
    f.closest('article[data-testid^="conversation-turn"]'),
  perform_copy: async (f) => {
    // existing copy logic unchanged
    const copy_button = f.querySelector(
      'button[data-testid="copy-turn-action-button"]'
    ) as HTMLElement
    copy_button?.click()
  },
  // V1
  extract_response_text: (f) => {
    const article = f.closest(
      'article[data-testid^="conversation-turn"]'
    ) as HTMLElement | null
    if (!article) return ''
    // ChatGPT response prose lives in .markdown.prose
    const prose = article.querySelector('.markdown.prose') as HTMLElement | null
    if (prose) return prose.innerText.trim()
    const clone = article.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.cwc-apply-response-button').forEach((n) => n.remove())
    return clone.innerText.trim()
  },
  insert_button: (f, b) => f.appendChild(b)
})
```

### Gemini (`chatbots/gemini.ts`)

Gemini uses a custom element `<model-response>` as the response container.

```ts
// Inside gemini.ts — update the add_apply_response_button call:
add_apply_response_button({
  client_id: params.client_id,
  request_id: params.request_id,
  raw_instructions: params.raw_instructions,
  edit_format: params.edit_format,
  footer,
  get_chat_turn: (f) => f.closest('model-response'),
  perform_copy: async (f) => {
    // existing copy logic unchanged
    const copy_button = f.querySelector(
      'button[aria-label="Copy"]'
    ) as HTMLElement
    copy_button?.click()
  },
  // V1
  extract_response_text: (f) => {
    const model_response = f.closest('model-response') as HTMLElement | null
    if (!model_response) return ''
    // Gemini renders markdown inside message-content
    const content = model_response.querySelector(
      'message-content'
    ) as HTMLElement | null
    if (content) return content.innerText.trim()
    const clone = model_response.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.cwc-apply-response-button').forEach((n) => n.remove())
    return clone.innerText.trim()
  },
  insert_button: (f, b) => f.appendChild(b)
})
```

---

## File 5: how `request_id` flows from `initialize-chat` to the chatbot

The content script must store `request_id` from the incoming `initialize-chat` message and pass it to `add_apply_response_button`. The storage pattern already exists for `client_id` — add `request_id` alongside it.

In `send-prompt-content-script.ts` (simplified diff):

```ts
// When receiving initialize-chat message, store request_id alongside client_id:
const stored_data = {
  client_id: message.client_id,
  request_id: message.request_id,  // V1: may be undefined for VS Code clients
  raw_instructions: message.raw_instructions,
  edit_format: message.edit_format,
  // ... other fields
}

// When calling chatbot.observe_for_responses or add_apply_response_button,
// pass stored_data.request_id through:
chatbot.observe_for_responses({
  client_id: stored_data.client_id,
  request_id: stored_data.request_id,  // V1
  // ...
})
```

Update the `Chatbot` interface in `types/chatbot.ts` to include `request_id` in the params passed to `observe_for_responses` (or equivalent) so the type system enforces propagation.

---

## File 6: `apps/mcp-server/src/cwc-bridge-v1.ts`

Replaces the single pending-response slot with a request map. Prefers `response_text` and falls back to clipboard for backward compatibility.

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

      const timer = setTimeout(
        () => reject(new CwcMcpError('Timed out connecting to CodeWebChat.', 'CWC_NOT_CONNECTED')),
        this.options.connect_timeout_ms ?? 3000
      )

      ws.on('open', () => {
        clearTimeout(timer)
        resolve()
      })

      ws.on('error', reject)

      ws.on('close', () => {
        this.ws = null
        this.client_id = null
        this.browser_connected = false
        // Reject all pending requests immediately on disconnect
        for (const [request_id, pending] of this.pending_requests) {
          clearTimeout(pending.timer)
          pending.reject(
            new CwcMcpError(
              `Connection closed before request ${request_id} completed.`,
              'CWC_DISCONNECTED'
            )
          )
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
      // If multiple requests are in flight (should not happen in V1 but could in mixed
      // client environments), log and skip to avoid resolving the wrong request.
      if (this.pending_requests.size !== 1) {
        console.error(
          '[cwc-mcp-v1] apply-chat-response received without request_id ' +
          `and ${this.pending_requests.size} requests pending — skipping to avoid ambiguity`
        )
        return
      }
      const only_request_id = [...this.pending_requests.keys()][0]
      await this.resolveRequestFromClipboard(only_request_id)
      return
    }

    const pending = this.pending_requests.get(message.request_id)
    if (!pending) return
    if (pending.client_id !== message.client_id) return

    clearTimeout(pending.timer)
    this.pending_requests.delete(message.request_id)

    // Prefer response_text — skip clipboard entirely
    if (message.response_text?.trim()) {
      pending.resolve(message.response_text)
      return
    }

    // Fallback: clipboard (V0 path, for browser extensions not yet updated)
    await this.resolveRequestFromClipboard(message.request_id, pending)
  }

  private async resolveRequestFromClipboard(
    request_id: string,
    existing?: PendingRequest
  ): Promise<void> {
    const pending = existing ?? this.pending_requests.get(request_id)
    if (!pending) return

    await new Promise((resolve) =>
      setTimeout(resolve, this.options.clipboard_read_delay_ms ?? 250)
    )
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

---

## V1 acceptance criteria

```text
[ ] packages/shared/src/types/websocket-message.ts adds optional request_id to InitializeChatMessage.
[ ] packages/shared/src/types/websocket-message.ts adds optional request_id + response_text to ApplyChatResponseMessage.
[ ] apps/browser/src/types/messages.ts adds optional request_id + response_text to ApplyChatResponseMessage.
[ ] add_apply_response_button accepts optional request_id and extract_response_text params.
[ ] claude.ts passes request_id and extract_response_text to add_apply_response_button.
[ ] chatgpt.ts passes request_id and extract_response_text to add_apply_response_button.
[ ] gemini.ts passes request_id and extract_response_text to add_apply_response_button.
[ ] Remaining chatbots tracked in a follow-up issue; they still work via clipboard fallback.
[ ] Existing VS Code clipboard flow still works (no params changed are required).
[ ] MCP server (cwc-bridge-v1.ts) prefers response_text over clipboard.
[ ] Concurrent MCP requests resolve independently via request_id map.
[ ] Disconnect rejects all pending requests immediately (CWC_DISCONNECTED).
[ ] Tests cover V0 clipboard fallback, V1 response_text path, and disconnect rejection.
```

---

## Implementation order

1. Update shared types (`websocket-message.ts`) — no behavior change, additive only.
2. Update browser `messages.ts` — TypeScript types only.
3. Update `add_apply_response_button` — additive params, backward compatible.
4. Update `claude.ts` first as the reference implementation and verify manually.
5. Update `chatgpt.ts` and `gemini.ts`.
6. Switch MCP server from `CwcBridge` to `CwcBridgeV1` in `index.ts`.
7. File follow-up issue for remaining 17 chatbot integrations.
