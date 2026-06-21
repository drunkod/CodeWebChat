import { randomUUID } from 'node:crypto'
import { CwcMcpError } from './errors.js'
import type { BridgeStatus, CwcTransport } from './transport.js'
import type {
  InitializeChatMessage,
  ApplyChatResponseMessage
} from './protocol.js'
import type { JazzConfig } from './jazz-config.js'
import { app } from '../../../packages/shared/src/jazz/schema.js'

export type BackendDbFactory = (config: JazzConfig) => Promise<any>

type ChatResponseRow = {
  request_id: string
  response_text?: string
}

export class JazzTransport implements CwcTransport {
  public readonly mode = 'host' as const
  private db: any | null = null
  private unsubscribe: (() => void) | null = null
  private connected = false
  private browser_seen_at = 0
  private apply_handler: (m: ApplyChatResponseMessage) => void = () => {}
  private close_handler: (e?: unknown) => void = () => {}
  private readonly inflight = new Map<string, number>()

  constructor(
    private readonly config: JazzConfig,
    private readonly makeDb: BackendDbFactory = defaultMakeDb
  ) {}

  onApplyResponse(h: (m: ApplyChatResponseMessage) => void): void {
    this.apply_handler = h
  }
  onClose(h: (e?: unknown) => void): void {
    this.close_handler = h
  }

  status(): BridgeStatus {
    const alive = Date.now() - this.browser_seen_at < 15_000
    return {
      mode: this.mode,
      hosting: this.connected,
      websocket_connected: this.connected,
      client_id: this.connected ? 1 : null,
      browser_connected: alive,
      connected_browser_count: alive ? 1 : 0
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return
    this.db = await this.makeDb(this.config)
    this.unsubscribe = this.db.subscribeAll(
      'chat_responses',
      ({ delta }: { delta: Array<{ item: ChatRequestRow }> }) => {
        for (const change of delta) {
          const row = change.item
          const client_id = this.inflight.get(row.request_id)
          if (client_id === undefined) continue
          this.inflight.delete(row.request_id)
          this.apply_handler({
            action: 'apply-chat-response',
            client_id,
            response_text: row.response_text ?? '',
            url: undefined
          } as ApplyChatResponseMessage & { response_text?: string })
        }
      }
    )
    this.connected = true
  }

  async ensureReady(): Promise<void> {
    await this.connect()
  }

  sendInitializeChat(message: InitializeChatMessage): void {
    if (!this.db)
      throw new CwcMcpError(
        'Jazz transport not connected.',
        'CWC_NOT_CONNECTED'
      )
    const request_id = randomUUID()
    this.inflight.set(request_id, message.client_id)
    void this.db
      .insert('chat_requests', {
        request_id,
        url: message.url,
        text: message.text,
        prompt_type: message.prompt_type ?? 'edit-context',
        status: 'pending',
        created_at: Date.now()
      })
      .catch((e: unknown) => {
        this.inflight.delete(request_id)
        this.close_handler(e)
      })
  }

  async close(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = null
    await this.db?.shutdown?.()
    this.db = null
    this.connected = false
  }

  markBrowserSeen(): void {
    this.browser_seen_at = Date.now()
  }
}

async function defaultMakeDb(_config: JazzConfig): Promise<any> {
  return {
    subscribeAll: (_q: unknown, _cb: unknown) => () => undefined,
    insert: async () => undefined,
    shutdown: async () => undefined
  }
}
