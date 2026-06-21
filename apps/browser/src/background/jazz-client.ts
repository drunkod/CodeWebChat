import { createDb } from 'jazz-tools'
import { app, type ChatRequestRow } from '@shared/jazz/schema'
import { getJazzBrowserSettings } from './jazz-settings'

type JazzDb = {
  subscribeAll: (
    queryOrTable: unknown,
    cb: (delta: unknown) => void | Promise<void>
  ) => (() => void) | Promise<() => void>
  insert: (table: unknown, row: unknown) => Promise<unknown>
  update?: (table: unknown, id: string, patch: unknown) => Promise<unknown>
  shutdown?: () => Promise<void>
}

type JazzChange<T> = { item: T }

type RequestWithMaybeId = ChatRequestRow & {
  id?: string
}

export type JazzClientHandle = {
  db: JazzDb
  stop: () => Promise<void>
}

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
    await db.update(app.chat_requests, id, { status })
  } catch (error) {
    console.warn('Could not update Jazz request status:', error)
  }
}

export async function startJazzClient(opts: {
  onRequest: (req: ChatRequestRow) => Promise<string>
}): Promise<JazzClientHandle | null> {
  const settings = await getJazzBrowserSettings()

  if (!settings.enabled) {
    return null
  }

  const db = (await createDb({
    appId: settings.appId,
    serverUrl: settings.serverUrl,
    secret: settings.secret,
    driver: { type: 'memory' }
  })) as unknown as JazzDb

  const seen = new Set<string>()

  const unsubscribe = await Promise.resolve(
    db.subscribeAll(
      app.chat_requests.where({ status: 'pending' }),
      async (deltaLike: unknown) => {
        const changes = normalizeDelta<ChatRequestRow>(deltaLike)

        for (const change of changes) {
          const req = change.item

          if (!req.request_id || seen.has(req.request_id)) {
            continue
          }

          seen.add(req.request_id)
          await updateRequestStatus(db, req, 'claimed')

          try {
            const response_text = await opts.onRequest(req)

            await db.insert(app.chat_responses, {
              request_id: req.request_id,
              response_text,
              status: 'done',
              error: undefined,
              created_at: Date.now()
            })

            await updateRequestStatus(db, req, 'done')
          } catch (error) {
            await db.insert(app.chat_responses, {
              request_id: req.request_id,
              response_text: '',
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
              created_at: Date.now()
            })

            await updateRequestStatus(db, req, 'failed')
          }
        }
      }
    )
  )

  return {
    db,
    stop: async () => {
      unsubscribe()
      await db.shutdown?.()
    }
  }
}
