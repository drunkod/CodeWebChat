import { randomUUID } from 'node:crypto'
import { CwcMcpError } from './errors.js'
import type { BridgeStatus, CwcTransport } from './transport.js'
import type {
  InitializeChatMessage,
  ApplyChatResponseMessage
} from './protocol.js'
import type { JazzConfig } from './jazz-config.js'
import { app } from '../../../packages/shared/dist/jazz/schema.js'
import permissions from '../../../packages/shared/dist/jazz/permissions.js'
import type {
  BrowserPresenceRow,
  ChatRequestInsert,
  ChatResponseRow
} from '../../../packages/shared/dist/jazz/schema.js'

type WaitHandle = {
  wait?: (opts?: { tier?: 'local' | 'edge' | 'global' }) => Promise<unknown>
}

type JazzChange<T> = { item?: T }

type JazzDb = {
  subscribeAll: (
    queryOrTable: unknown,
    cb: (
      delta: { delta?: Array<{ item?: unknown }> } | Array<{ item?: unknown }>
    ) => void
  ) => (() => void) | Promise<() => void>

  insert: (
    table: unknown,
    row: ChatRequestInsert
  ) => WaitHandle | Promise<WaitHandle | unknown>

  shutdown?: () => Promise<void>
}

export type BackendDbFactory = (config: JazzConfig) => Promise<JazzDb>

const BROWSER_PRESENCE_TTL_MS = 15_000

function normalizeDelta<T>(
  changeSet: { delta?: Array<{ item?: unknown }> } | Array<{ item?: unknown }>
): Array<JazzChange<T>> {
  if (Array.isArray(changeSet)) {
    return changeSet as Array<JazzChange<T>>
  }

  return (changeSet.delta ?? []) as Array<JazzChange<T>>
}

export class JazzTransport implements CwcTransport {
  public readonly mode = 'host' as const
  private db: JazzDb | null = null
  private unsubscribes: Array<() => void> = []
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
    const alive = Date.now() - this.browser_seen_at < BROWSER_PRESENCE_TTL_MS

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

    const maybeUnsubscribeResponses = this.db.subscribeAll(
      app.chat_responses,
      (changeSet) => {
        const delta = normalizeDelta<ChatResponseRow>(changeSet)

        for (const change of delta) {
          const row = change?.item
          if (!row) continue

          const client_id = this.inflight.get(row.request_id)
          if (client_id === undefined) continue

          this.browser_seen_at = Date.now()
          this.inflight.delete(row.request_id)

          if (row.status === 'error') {
            this.close_handler(
              new CwcMcpError(
                row.error ||
                  'CodeWebChat returned an error over Jazz transport.',
                'CWC_JAZZ_RESPONSE_ERROR'
              )
            )
            continue
          }

          this.apply_handler({
            action: 'apply-chat-response',
            client_id,
            response_text: row.response_text ?? '',
            url: undefined
          })
        }
      }
    )

    const maybeUnsubscribePresence = this.db.subscribeAll(
      app.browser_presence,
      (changeSet) => {
        const delta = normalizeDelta<BrowserPresenceRow>(changeSet)

        for (const change of delta) {
          const row = change?.item
          if (!row) continue
          if (row.status !== 'online') continue

          const seenAt =
            typeof row.seen_at === 'number' && Number.isFinite(row.seen_at)
              ? row.seen_at
              : Date.now()

          this.browser_seen_at = Math.max(this.browser_seen_at, seenAt)
        }
      }
    )

    this.unsubscribes = [
      await Promise.resolve(maybeUnsubscribeResponses),
      await Promise.resolve(maybeUnsubscribePresence)
    ]

    this.connected = true
  }

  async ensureReady(): Promise<void> {
    await this.connect()
  }

  sendInitializeChat(message: InitializeChatMessage): void {
    if (!this.db) {
      throw new CwcMcpError(
        'Jazz transport not connected.',
        'CWC_NOT_CONNECTED'
      )
    }

    const request_id = randomUUID()
    this.inflight.set(request_id, message.client_id)

    try {
      const result = this.db.insert(app.chat_requests, {
        request_id,
        url: message.url,
        text: message.text,
        prompt_type: message.prompt_type ?? 'edit-context',
        status: 'pending',
        created_at: Date.now()
      })

      void Promise.resolve(result)
        .then((handle) => (handle as WaitHandle)?.wait?.({ tier: 'edge' }))
        .catch((e: unknown) => {
          this.inflight.delete(request_id)
          this.close_handler(e)
        })
    } catch (e: unknown) {
      this.inflight.delete(request_id)
      this.close_handler(e)
    }
  }

  async close(): Promise<void> {
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe()
    }

    this.unsubscribes = []
    await this.db?.shutdown?.()
    this.db = null
    this.connected = false
    this.browser_seen_at = 0
    this.inflight.clear()
  }

  markBrowserSeen(): void {
    this.browser_seen_at = Date.now()
  }
}

async function defaultMakeDb(config: JazzConfig): Promise<JazzDb> {
  const backendModule = (await import('jazz-tools/backend')) as unknown as {
    createJazzContext: (options: {
      appId: string
      app: typeof app
      permissions: unknown
      serverUrl: string
      allowLocalFirstAuth: boolean
      backendSecret: string
      adminSecret?: string
      driver: { type: 'persistent'; dataPath: string } | { type: 'memory' }
    }) => {
      asBackend: () => JazzDb
    }
  }

  const context = backendModule.createJazzContext({
    appId: config.appId,
    app,
    permissions,
    serverUrl: config.serverUrl,
    allowLocalFirstAuth: true,
    backendSecret: config.backendSecret ?? 'cwc-rt-backend',
    adminSecret: config.adminSecret ?? 'cwc-rt-admin',
    driver: { type: 'persistent', dataPath: '.jazz/mcp-client.db' }
  })

  return context.asBackend()
}
