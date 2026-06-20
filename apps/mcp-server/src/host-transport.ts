import { createServer, type IncomingMessage, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import WebSocket, { WebSocketServer } from 'ws'
import { CwcMcpError } from './errors.js'
import {
  SECURITY_TOKENS,
  type ApplyChatResponseMessage,
  type BrowserConnectionStatusMessage,
  type CwcInboundMessage,
  type InitializeChatMessage
} from './protocol.js'
import type { BridgeStatus, CwcTransport } from './transport.js'

const HOST_PORT = 55155
const HOST_CLIENT_ID = 1
const PING_INTERVAL_MS = 10_000

type BrowserClient = {
  id: string
  socket: WebSocket
  user_agent?: string
}

type HostOptions = {
  port?: number
}

export class HostTransport implements CwcTransport {
  public readonly mode = 'host' as const

  private http_server: Server | null = null
  private wss: WebSocketServer | null = null
  private browsers = new Map<string, BrowserClient>()
  private listening = false
  private apply_handler: (message: ApplyChatResponseMessage) => void = () => {}
  private close_handler: (error?: unknown) => void = () => {}
  private ping_timer: ReturnType<typeof setInterval> | null = null
  private readonly port: number

  constructor(options: HostOptions = {}) {
    this.port = options.port ?? HOST_PORT
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
      hosting: this.listening,
      websocket_connected: this.listening,
      client_id: HOST_CLIENT_ID,
      browser_connected: this.browsers.size > 0,
      connected_browser_count: this.browsers.size
    }
  }

  public async connect(): Promise<void> {
    await this.start()
  }

  public async ensureReady(): Promise<void> {
    await this.start()
    if (this.browsers.size === 0) {
      throw new CwcMcpError(
        'No CodeWebChat browser client is connected. Open the browser extension before using this MCP tool.',
        'CWC_NO_BROWSER'
      )
    }
  }

  public sendInitializeChat(message: InitializeChatMessage): void {
    if (!this.wss) {
      throw new CwcMcpError(
        'Host transport is not listening.',
        'CWC_NOT_CONNECTED'
      )
    }
    const payload = JSON.stringify(message)
    for (const browser of this.browsers.values()) {
      if (browser.socket.readyState === WebSocket.OPEN) {
        browser.socket.send(payload)
      }
    }
  }

  public async close(): Promise<void> {
    this.ping_timer && clearInterval(this.ping_timer)
    this.ping_timer = null
    for (const browser of this.browsers.values()) {
      try {
        browser.socket.close()
      } catch {
        // ignore
      }
    }
    this.browsers.clear()
    this.wss?.close()
    this.http_server?.close()
    this.wss = null
    this.http_server = null
    this.listening = false
  }

  public address(): string {
    return `http://127.0.0.1:${this.boundPort()}`
  }

  public boundPort(): number {
    const addr = this.http_server?.address()
    if (typeof addr === 'object' && addr !== null) {
      return addr.port
    }
    return this.port
  }

  private async start(): Promise<void> {
    if (this.listening) return

    await new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok', port: this.port }))
          return
        }
        res.writeHead(404)
        res.end('not found')
      })

      server.on('error', (error: unknown) => {
        const err = error as NodeJS.ErrnoException
        if (err.code === 'EADDRINUSE') {
          reject(
            new CwcMcpError(
              `Port ${this.port} is already in use.`,
              'CWC_PORT_IN_USE'
            )
          )
          return
        }
        reject(error)
      })

      const wss = new WebSocketServer({ noServer: true })
      server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`)
        const token = url.searchParams.get('token')
        if (token !== SECURITY_TOKENS.BROWSERS) {
          socket.destroy()
          return
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req)
        })
      })

      wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
        const id = randomUUID()
        const client: BrowserClient = {
          id,
          socket,
          user_agent: req.headers['user-agent']
        }
        this.browsers.set(id, client)
        this.publishBrowserStatus()

        socket.on('message', (raw) =>
          this.handleMessage(raw.toString(), socket)
        )
        socket.on('close', () => {
          this.browsers.delete(id)
          this.publishBrowserStatus()
          this.close_handler(
            new CwcMcpError(
              'A CodeWebChat browser client disconnected.',
              'CWC_BROWSER_GONE'
            )
          )
        })
      })

      server.listen(this.port, () => {
        this.http_server = server
        this.wss = wss
        this.listening = true
        this.ping_timer = setInterval(
          () => this.pingBrowsers(),
          PING_INTERVAL_MS
        )
        resolve()
      })
    })
  }

  private handleMessage(raw: string, socket: WebSocket): void {
    let message: CwcInboundMessage
    try {
      message = JSON.parse(raw) as CwcInboundMessage
    } catch {
      return
    }

    if (message.action === 'apply-chat-response') {
      this.apply_handler(message as ApplyChatResponseMessage)
      return
    }

    if (message.action === 'browser-connection-status') {
      const status = message as BrowserConnectionStatusMessage
      if (
        status.connected_browsers?.length === 0 &&
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close()
      }
    }
  }

  private publishBrowserStatus(): void {
    const payload = JSON.stringify({
      action: 'browser-connection-status',
      connected_browsers: Array.from(this.browsers.values()).map((browser) => ({
        id: parseInt(browser.id.replace(/-/g, '').slice(0, 8), 16),
        name: browser.user_agent
      }))
    })
    for (const browser of this.browsers.values()) {
      if (browser.socket.readyState === WebSocket.OPEN) {
        browser.socket.send(payload)
      }
    }
  }

  private pingBrowsers(): void {
    const ping = JSON.stringify({ action: 'ping' })
    for (const browser of this.browsers.values()) {
      if (browser.socket.readyState === WebSocket.OPEN) {
        browser.socket.send(ping)
      }
    }
  }
}
