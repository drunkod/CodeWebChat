import { createDb } from 'jazz-tools'
import { app, type ChatRequestRow } from '@shared/jazz/schema'
import { getJazzBrowserSettings } from './jazz-settings'

type JazzDb = {
  subscribeAll: (
    queryOrTable: unknown,
    cb: (delta: unknown) => void | Promise<void>
  ) => (() => void) | Promise<() => void>
  // insert/update return a synchronous write handle, NOT a Promise. You must
  // call .wait({ tier }) on the handle to await durability — `await db.insert(...)`
  // alone resolves immediately at the local tier and does not confirm the write
  // reached the sync server.
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

    console.log('Jazz client: drainQueue running, queue length:', queue.length)
    try {
      while (queue.length > 0) {
        const req = queue.shift()!
        console.log('Jazz client: processing request', req.request_id)
        try {
          console.log('Jazz client: updating status to claimed')
          await updateRequestStatus(db, req, 'claimed')
          console.log('Jazz client: status updated, calling onRequest')

          const response_text = await opts.onRequest(req)
          console.log('Jazz client: onRequest returned, inserting response')
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
        } catch (error) {
          console.error('Jazz client: request processing error:', error instanceof Error ? error.message : String(error))
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

  console.log('Jazz client: subscribing to pending chat_requests')
  const unsubscribe = await Promise.resolve(
    db.subscribeAll(
      app.chat_requests.where({ status: 'pending' }),
      (deltaLike: unknown) => {
        console.log('Jazz client: subscribeAll delta received', JSON.stringify(deltaLike).slice(0, 200))
        const changes = normalizeDelta<ChatRequestRow>(deltaLike)
        console.log('Jazz client: normalized changes count:', changes.length)
        for (const change of changes) {
          const req = change.item
          if (!req?.request_id) continue
          console.log('Jazz client: enqueueing request', req.request_id)
          enqueue(req)
        }
      }
    )
  )
  console.log('Jazz client: subscription established')

  return {
    db,
    stop: async () => {
      unsubscribe()
      await db.shutdown?.()
    }
  }
}
