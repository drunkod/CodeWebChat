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
}): Promise<JazzClientHandle | null> {
  const settings = await getJazzBrowserSettings()

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

  const unsubscribe = await Promise.resolve(
    db.subscribeAll(
      app.chat_requests.where({ status: 'pending' }),
      async (deltaLike: unknown) => {
        const changes = normalizeDelta<ChatRequestRow>(deltaLike)

        for (const change of changes) {
          const req = change.item

          if (!req?.request_id || processing.has(req.request_id)) {
            continue
          }

          processing.add(req.request_id)
          await updateRequestStatus(db, req, 'claimed')

          try {
            const response_text = await opts.onRequest(req)

            // .wait({ tier: 'edge' }) confirms the reply reached the sync server
            // before this MV3 service worker can be suspended/killed — otherwise
            // a local-only write can be lost and the MCP peer never sees it.
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
