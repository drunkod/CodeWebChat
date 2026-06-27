import { createDb } from 'jazz-tools'
import { app, type ChatRequestRow } from '@shared/jazz/schema'
import { getJazzBrowserSettings } from './jazz-settings'

type JazzDb = {
  subscribeAll: (
    queryOrTable: unknown,
    cb: (delta: unknown) => void | Promise<void>
  ) => (() => void) | Promise<() => void>

  insert: (
    table: unknown,
    row: unknown
  ) => {
    wait: (opts?: { tier?: 'local' | 'edge' | 'global' }) => Promise<unknown>
  }

  update?: (
    table: unknown,
    id: string,
    patch: unknown
  ) => {
    wait: (opts?: { tier?: 'local' | 'edge' | 'global' }) => Promise<unknown>
  }

  shutdown?: () => Promise<void>
}

type JazzChange<T> = { item?: T }

type RequestWithMaybeId = ChatRequestRow & {
  id?: string
}

export type JazzClientHandle = {
  db: JazzDb
  stop: () => Promise<void>
}

const uuidRe =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const PRESENCE_INTERVAL_MS = 5_000

function normalizeDelta<T>(deltaLike: unknown): Array<JazzChange<T>> {
  if (Array.isArray(deltaLike)) return deltaLike as Array<JazzChange<T>>

  if (
    deltaLike &&
    typeof deltaLike === 'object' &&
    Array.isArray((deltaLike as { delta?: unknown }).delta)
  ) {
    return (deltaLike as { delta: Array<JazzChange<T>> }).delta
  }

  return []
}

function randomBrowserId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function updateRequestStatus(
  db: JazzDb,
  req: ChatRequestRow,
  status: 'claimed' | 'done' | 'failed'
): Promise<void> {
  const id = (req as RequestWithMaybeId).id
  if (!id || !db.update) return

  try {
    await db.update(app.chat_requests, id, { status }).wait({ tier: 'edge' })
  } catch (error) {
    console.warn('Could not update Jazz request status:', error)
  }
}

async function writePresence(
  db: JazzDb,
  browserId: string,
  tier: 'local' | 'edge' = 'edge'
): Promise<void> {
  try {
    const now = Date.now()
    await db
      .insert(app.browser_presence, {
        browser_id: browserId,
        status: 'online',
        seen_at: now,
        created_at: now
      })
      .wait({ tier })
  } catch (error) {
    console.warn('Could not write Jazz browser presence:', error)
  }
}

export async function startJazzClient(opts: {
  onRequest: (req: ChatRequestRow) => Promise<string>
  settings?: {
    enabled: boolean
    appId: string
    serverUrl: string
    secret: string
  }
}): Promise<JazzClientHandle | null> {
  const settings = opts.settings ?? (await getJazzBrowserSettings())

  if (!settings.enabled) {
    return null
  }

  if (!uuidRe.test(settings.appId)) {
    console.warn(
      'Jazz is enabled, but cwc_jazz_app_id is missing or not a UUID. Run scripts/jazz-server.sh and set cwc_jazz_app_id to the value in .jazz/app-id.'
    )
    return null
  }

  const db = (await createDb({
    appId: settings.appId,
    serverUrl: settings.serverUrl,
    secret: settings.secret,
    driver: { type: 'memory' },
    runtimeSources: {
      wasmUrl: chrome.runtime.getURL('1146eb6d15fb5f66424a.wasm')
    }
  })) as unknown as JazzDb

  const browserId = randomBrowserId()

  // First heartbeat immediately, then repeat. Keep it outside subscription
  // callbacks, same reason request writes are queued: avoid re-entering Jazz
  // while it is delivering subscription changes.
  void writePresence(db, browserId, 'edge')

  const presenceTimer = setInterval(() => {
    void writePresence(db, browserId, 'edge')
  }, PRESENCE_INTERVAL_MS)

  const processing = new Set<string>()
  const queue: ChatRequestRow[] = []
  let draining = false

  function enqueue(req: ChatRequestRow): void {
    if (!req.request_id || processing.has(req.request_id)) return
    processing.add(req.request_id)
    queue.push(req)

    if (!draining) {
      draining = true
      setTimeout(() => void drainQueue(), 0)
    }
  }

  async function drainQueue(): Promise<void> {
    // Yield before any Jazz writes so we are off the subscribeAll call stack.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    try {
      while (queue.length > 0) {
        const req = queue.shift()!

        try {
          await updateRequestStatus(db, req, 'claimed')

          const response_text = await opts.onRequest(req)

          await db
            .insert(app.chat_responses, {
              request_id: req.request_id,
              response_text,
              status: 'done',
              error: undefined,
              created_at: Date.now()
            })
            .wait({ tier: 'edge' })

          await updateRequestStatus(db, req, 'done')

          // A completed response also proves browser presence.
          void writePresence(db, browserId, 'edge')
        } catch (error) {
          await db
            .insert(app.chat_responses, {
              request_id: req.request_id,
              response_text: '',
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
              created_at: Date.now()
            })
            .wait({ tier: 'edge' })

          await updateRequestStatus(db, req, 'failed')

          // An error response still proves the browser peer is alive.
          void writePresence(db, browserId, 'edge')
        } finally {
          processing.delete(req.request_id)
        }
      }
    } finally {
      draining = false

      if (queue.length > 0) {
        draining = true
        setTimeout(() => void drainQueue(), 0)
      }
    }
  }

  const unsubscribe = await Promise.resolve(
    db.subscribeAll(
      app.chat_requests.where({ status: 'pending' }),
      (deltaLike: unknown) => {
        const changes = normalizeDelta<ChatRequestRow>(deltaLike)

        for (const change of changes) {
          const req = change.item
          if (!req?.request_id) continue
          enqueue(req)
        }
      }
    )
  )

  return {
    db,
    stop: async () => {
      clearInterval(presenceTimer)
      unsubscribe()
      await db.shutdown?.()
    }
  }
}
