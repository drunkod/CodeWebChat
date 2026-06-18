# Step 2 — Build the CodeWebChat WebSocket Bridge

## Goal

Create the local bridge that connects the MCP server to the existing CodeWebChat WebSocket server as a VS Code-role client.

This is the fastest prototype path because CodeWebChat already supports multiple editor-role clients. Each editor-role client receives a `client_id`, and the browser serializes prompt handling through its `chat_queue`. For the V0 MCP server, requests should still be serialized per MCP process because `client_id` identifies the connection, not an individual request.

## Behavior

The bridge must:

1. Connect to `ws://localhost:55155?token=gemini-coder-vscode`.
2. Wait for `client-id-assignment`.
3. Track whether any browser extension is connected.
4. Send `initialize-chat` messages.
5. Wait for `apply-chat-response` for the assigned `client_id`.
6. Read the clipboard only after `apply-chat-response` arrives.
7. Reject empty or unchanged clipboard text.
8. Serialize calls so concurrent MCP tool calls do not race on the same `client_id` and clipboard.

## Complete file: `apps/mcp-server/src/cwc-bridge.ts`

```ts
import WebSocket from 'ws'
import { CwcMcpError } from './errors.js'
import type { ReadClipboard } from './clipboard.js'
import {
  DEFAULT_CWC_PORT,
  SECURITY_TOKENS,
  type ApplyChatResponseMessage,
  type BrowserConnectionStatusMessage,
  type ClientIdAssignmentMessage,
  type CwcInboundMessage,
  type InitializeChatMessage
} from './protocol.js'

type SendPromptInput = Omit<InitializeChatMessage, 'action' | 'client_id'> & {
  timeout_ms?: number
}

type BridgeOptions = {
  ws_url?: string
  vscode_token?: string
  read_clipboard: ReadClipboard
  connect_timeout_ms?: number
  clipboard_read_delay_ms?: number
}

type BridgeStatus = {
  websocket_connected: boolean
  client_id: number | null
  browser_connected: boolean
  connected_browser_count: number
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const parseJson = (raw: string): CwcInboundMessage => {
  try {
    return JSON.parse(raw) as CwcInboundMessage
  } catch {
    throw new CwcMcpError('Received a non-JSON message from CodeWebChat.', 'CWC_BAD_MESSAGE')
  }
}

export class CwcBridge {
  private ws: WebSocket | null = null
  private client_id: number | null = null
  private browser_connected = false
  private connected_browser_count = 0
  private readonly ws_url: string
  private readonly vscode_token: string
  private readonly read_clipboard: ReadClipboard
  private readonly connect_timeout_ms: number
  private readonly clipboard_read_delay_ms: number
  private active_request: Promise<unknown> = Promise.resolve()
  private pending_apply_response: ((message: ApplyChatResponseMessage) => void) | null = null

  constructor(options: BridgeOptions) {
    this.ws_url = options.ws_url ?? `ws://localhost:${DEFAULT_CWC_PORT}`
    this.vscode_token = options.vscode_token ?? SECURITY_TOKENS.VSCODE
    this.read_clipboard = options.read_clipboard
    this.connect_timeout_ms = options.connect_timeout_ms ?? 3000
    this.clipboard_read_delay_ms = options.clipboard_read_delay_ms ?? 250
  }

  public status(): BridgeStatus {
    return {
      websocket_connected: this.ws?.readyState === WebSocket.OPEN,
      client_id: this.client_id,
      browser_connected: this.browser_connected,
      connected_browser_count: this.connected_browser_count
    }
  }

  public async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN && this.client_id !== null) {
      return
    }

    const url = new URL(this.ws_url)
    url.searchParams.set('token', this.vscode_token)
    url.searchParams.set('vscode_extension_version', 'cwc-mcp-server-0.1.0')

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url.toString())
      this.ws = ws

      const timer = setTimeout(() => {
        reject(
          new CwcMcpError(
            `Timed out connecting to CodeWebChat at ${this.ws_url}. Start the CodeWebChat WebSocket server first.`,
            'CWC_NOT_CONNECTED'
          )
        )
      }, this.connect_timeout_ms)

      ws.on('open', () => {
        clearTimeout(timer)
        resolve()
      })

      ws.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })

      ws.on('close', () => {
        this.ws = null
        this.client_id = null
        this.browser_connected = false
        this.connected_browser_count = 0
        this.pending_apply_response = null
      })

      ws.on('message', (raw) => {
        void this.handleMessage(raw.toString())
      })
    })

    await this.waitForClientId()
  }

  public async sendPromptAndWait(input: SendPromptInput): Promise<string> {
    const run = async (): Promise<string> => {
      await this.connect()
      this.assertReadyToSend()

      const client_id = this.client_id
      if (client_id === null) {
        throw new CwcMcpError('CodeWebChat did not assign a client_id.', 'CWC_NO_CLIENT_ID')
      }

      const before_clipboard = await this.read_clipboard()
      const timeout_ms = input.timeout_ms ?? 300000

      const apply_response_promise = this.waitForApplyResponse(client_id, timeout_ms)

      const message: InitializeChatMessage = {
        action: 'initialize-chat',
        text: input.text,
        url: input.url,
        client_id,
        model: input.model,
        target_browser_id: input.target_browser_id,
        temperature: input.temperature,
        thinking_budget: input.thinking_budget,
        reasoning_effort: input.reasoning_effort,
        top_p: input.top_p,
        system_instructions: input.system_instructions,
        options: input.options,
        raw_instructions: input.raw_instructions,
        edit_format: input.edit_format,
        prompt_type: input.prompt_type,
        reuse_last_tab: input.reuse_last_tab,
        invocation_count: input.invocation_count
      }

      this.ws!.send(JSON.stringify(message))
      await apply_response_promise
      await sleep(this.clipboard_read_delay_ms)

      const after_clipboard = await this.read_clipboard()
      if (!after_clipboard.trim()) {
        throw new CwcMcpError('Apply Response completed, but the clipboard was empty.', 'CWC_CLIPBOARD_EMPTY')
      }

      if (after_clipboard === before_clipboard) {
        throw new CwcMcpError(
          'Apply Response completed, but the clipboard did not change. Refusing to return stale clipboard content.',
          'CWC_CLIPBOARD_UNCHANGED'
        )
      }

      return after_clipboard
    }

    const previous = this.active_request
    let release!: () => void
    this.active_request = new Promise((resolve) => {
      release = resolve
    })

    await previous
    try {
      return await run()
    } finally {
      release()
    }
  }

  private async handleMessage(raw: string): Promise<void> {
    const message = parseJson(raw)

    if (message.action === 'client-id-assignment') {
      const assignment = message as ClientIdAssignmentMessage
      this.client_id = assignment.client_id
      return
    }

    if (message.action === 'browser-connection-status') {
      const status = message as BrowserConnectionStatusMessage
      this.browser_connected = Boolean(status.has_connected_browsers)
      this.connected_browser_count = status.connected_browsers?.length ?? (status.has_connected_browsers ? 1 : 0)
      return
    }

    if (message.action === 'apply-chat-response') {
      const apply_response = message as ApplyChatResponseMessage
      this.pending_apply_response?.(apply_response)
    }
  }

  private async waitForClientId(): Promise<void> {
    const started_at = Date.now()
    while (this.client_id === null) {
      if (Date.now() - started_at > this.connect_timeout_ms) {
        throw new CwcMcpError('Connected to CodeWebChat, but did not receive client-id-assignment.', 'CWC_NO_CLIENT_ID')
      }
      await sleep(50)
    }
  }

  private assertReadyToSend(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new CwcMcpError('Not connected to CodeWebChat WebSocket server.', 'CWC_NOT_CONNECTED')
    }

    if (!this.browser_connected) {
      throw new CwcMcpError(
        'No CodeWebChat browser extension is connected. Open the browser extension before using this MCP tool.',
        'CWC_NO_BROWSER'
      )
    }
  }

  private async waitForApplyResponse(client_id: number, timeout_ms: number): Promise<ApplyChatResponseMessage> {
    return await new Promise<ApplyChatResponseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending_apply_response = null
        reject(
          new CwcMcpError(
            `Timed out after ${timeout_ms}ms waiting for Apply Response. The user must click Apply Response in the chatbot tab.`,
            'CWC_TIMEOUT'
          )
        )
      }, timeout_ms)

      this.pending_apply_response = (message) => {
        if (message.client_id !== client_id) return
        clearTimeout(timer)
        this.pending_apply_response = null
        resolve(message)
      }
    })
  }
}
```

## Notes for the architect

- This bridge intentionally serializes tool calls.
- Serialization avoids ambiguity because the current protocol has no per-request `request_id`.
- The V0 bridge treats the clipboard as a transport fallback, not as a durable API.
- V1 should include response text in the WebSocket payload and add `request_id` to both prompt and response messages.
