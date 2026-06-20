import WebSocket from 'ws'
import { CwcMcpError } from './errors.js'
import {
  DEFAULT_CWC_PORT,
  SECURITY_TOKENS,
  type ApplyChatResponseMessage,
  type BrowserConnectionStatusMessage,
  type ClientIdAssignmentMessage,
  type CwcInboundMessage,
  type InitializeChatMessage
} from './protocol.js'
import type { BridgeStatus, CwcTransport } from './transport.js'

type ClientTransportOptions = {
  ws_url?: string
  vscode_token?: string
  connect_timeout_ms?: number
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Mode A transport: connects to the CodeWebChat WebSocket server (hosted by the
 * VS Code editor extension) as a vscode-role client. Pure transport — no
 * clipboard, no request tracking (that is RequestRegistry's job).
 */
export class ClientTransport implements CwcTransport {
  public readonly mode = 'client' as const

  private ws: WebSocket | null = null
  private client_id: number | null = null
  private browser_connected = false
  private connected_browser_count = 0

  private apply_handler: (message: ApplyChatResponseMessage) => void = () => {}
  private close_handler: (error?: unknown) => void = () => {}

  private readonly ws_url: string
  private readonly vscode_token: string
  private readonly connect_timeout_ms: number

  constructor(options: ClientTransportOptions = {}) {
    this.ws_url = options.ws_url ?? `ws://localhost:${DEFAULT_CWC_PORT}`
    this.vscode_token = options.vscode_token ?? SECURITY_TOKENS.VSCODE
    this.connect_timeout_ms = options.connect_timeout_ms ?? 3000
  }

  public onApplyResponse(
    handler: (message: ApplyChatResponseMessage) => void
  ): void {
    this.apply_handler = handler
  }

  public onClose(handler: (error?: unknown) => void): void {
    this.close_handler = handler
  }

  public status(): BridgeStatus {
    return {
      mode: this.mode,
      hosting: false,
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
        try {
          ws.terminate()
        } catch {
          // ignore terminate errors during connect timeout cleanup
        }
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
        try {
          ws.terminate()
        } catch {
          // ignore terminate errors during connect failure cleanup
        }
        reject(
          new CwcMcpError(
            `Could not connect to CodeWebChat at ${this.ws_url}. Start the CodeWebChat WebSocket server first. (${error instanceof Error ? error.message : String(error)})`,
            'CWC_NOT_CONNECTED'
          )
        )
      })

      ws.on('close', () => {
        this.ws = null
        this.client_id = null
        this.browser_connected = false
        this.connected_browser_count = 0
        this.close_handler(
          new CwcMcpError(
            'CodeWebChat WebSocket closed while waiting for Apply Response. ' +
              'The VS Code extension may have restarted. Retry the tool call.',
            'CWC_DISCONNECTED'
          )
        )
      })

      ws.on('message', (raw) => {
        this.handleMessage(raw.toString())
      })
    })

    await this.waitForClientId()
  }

  public async ensureReady(): Promise<void> {
    await this.connect()
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new CwcMcpError(
        'Not connected to CodeWebChat WebSocket server.',
        'CWC_NOT_CONNECTED'
      )
    }
    if (!this.browser_connected) {
      throw new CwcMcpError(
        'No CodeWebChat browser extension is connected. Open the browser extension before using this MCP tool.',
        'CWC_NO_BROWSER'
      )
    }
  }

  public sendInitializeChat(message: InitializeChatMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new CwcMcpError(
        'Not connected to CodeWebChat WebSocket server.',
        'CWC_NOT_CONNECTED'
      )
    }
    this.ws.send(JSON.stringify(message))
  }

  public async close(): Promise<void> {
    this.ws?.close()
  }

  private handleMessage(raw: string): void {
    let message: CwcInboundMessage
    try {
      message = JSON.parse(raw) as CwcInboundMessage
    } catch {
      return // ignore non-JSON noise
    }

    if (message.action === 'client-id-assignment') {
      this.client_id = (message as ClientIdAssignmentMessage).client_id
      return
    }

    if (message.action === 'browser-connection-status') {
      const status = message as BrowserConnectionStatusMessage
      this.connected_browser_count = status.connected_browsers?.length ?? 0
      this.browser_connected = this.connected_browser_count > 0
      return
    }

    if (message.action === 'apply-chat-response') {
      const apply = message as ApplyChatResponseMessage
      if (apply.client_id === this.client_id) {
        this.apply_handler(apply)
      }
    }
  }

  private async waitForClientId(): Promise<void> {
    const started_at = Date.now()
    while (this.client_id === null) {
      if (Date.now() - started_at > this.connect_timeout_ms) {
        throw new CwcMcpError(
          'Connected to CodeWebChat, but did not receive client-id-assignment.',
          'CWC_NO_CLIENT_ID'
        )
      }
      await sleep(50)
    }
  }
}
