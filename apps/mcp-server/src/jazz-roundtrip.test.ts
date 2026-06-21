import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RUN_ROUNDTRIP = process.env.CWC_RUN_JAZZ_ROUNDTRIP === '1'
const TEST_TIMEOUT_MS = Number(process.env.CWC_JAZZ_TEST_TIMEOUT_MS ?? 10000)

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function withTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeout = TEST_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timed = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeout}ms`)),
      timeout
    )
  })

  try {
    return await Promise.race([promise, timed])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function waitFor(
  cond: () => boolean,
  timeout = TEST_TIMEOUT_MS
): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timed out')
    await sleep(20)
  }
}

async function loadSharedJazzApp(): Promise<any> {
  const schemaUrl = new URL(
    '../../../packages/shared/dist/jazz/schema.js',
    import.meta.url
  )
  const mod = (await import(schemaUrl.href)) as { app: any }
  return mod.app
}

async function loadSharedJazzPermissions(): Promise<any> {
  const permissionsUrl = new URL(
    '../../../packages/shared/dist/jazz/permissions.js',
    import.meta.url
  )
  const mod = (await import(permissionsUrl.href)) as { default: any }
  return mod.default
}

test(
  'two peers exchange request/response rows over the local server',
  {
    skip: RUN_ROUNDTRIP
      ? false
      : 'set CWC_RUN_JAZZ_ROUNDTRIP=1 to run — NOTE: requires jazz-napi with HTTP admin endpoint (not in alpha.51 published binary; schema publishing via pushSchemaCatalogue 404s)'
  },
  async (t) => {
    t.signal?.throwIfAborted?.()

    const [app, permissions] = await Promise.all([
      withTimeout('import shared Jazz schema', loadSharedJazzApp()),
      withTimeout('import shared Jazz permissions', loadSharedJazzPermissions())
    ])

    const { startLocalJazzServer } = await withTimeout(
      'import jazz-tools/dev',
      import('jazz-tools/dev') as unknown as Promise<{
        startLocalJazzServer: (opts: Record<string, unknown>) => Promise<{
          appId: string
          port: number
          url: string
          backendSecret?: string
          adminSecret?: string
          stop: () => Promise<void>
        }>
      }>
    )

    // inMemory server is sufficient for the test — no disk state needed
    const server = await withTimeout(
      'startLocalJazzServer',
      startLocalJazzServer({ inMemory: true })
    )
    const backendSecret = server.backendSecret ?? 'cwc-rt-backend-secret'
    const adminSecret = server.adminSecret ?? 'cwc-rt-admin-secret'

    const dbDirA = mkdtempSync(join(tmpdir(), 'cwc-dbA-'))
    const dbDirB = mkdtempSync(join(tmpdir(), 'cwc-dbB-'))

    let dbA: any
    let dbB: any
    let ctxA: any
    let ctxB: any
    let unsubRequests: (() => void) | undefined
    let unsubResponses: (() => void) | undefined

    try {
      const { createJazzContext } = await withTimeout(
        'import jazz-tools/backend',
        import('jazz-tools/backend') as unknown as Promise<{
          createJazzContext: (opts: Record<string, any>) => {
            asBackend: () => any
          }
        }>
      )

      // env:'dev' enables structural schema auto-sync — no pushSchemaCatalogue needed
      ctxA = createJazzContext({
        appId: server.appId,
        app,
        permissions,
        serverUrl: server.url,
        allowLocalFirstAuth: true,
        backendSecret,
        adminSecret,
        driver: { type: 'persistent', dataPath: join(dbDirA, 'db.sqlite') },
        env: 'dev',
        userBranch: 'main'
      })
      dbA = ctxA.asBackend()

      ctxB = createJazzContext({
        appId: server.appId,
        app,
        permissions,
        serverUrl: server.url,
        allowLocalFirstAuth: true,
        backendSecret,
        adminSecret,
        driver: { type: 'persistent', dataPath: join(dbDirB, 'db.sqlite') },
        env: 'dev',
        userBranch: 'main'
      })
      dbB = ctxB.asBackend()

      let received: string | null = null

      // Peer B: simulate the browser extension — subscribe to requests, echo responses
      const maybeUnsubRequests = dbB.subscribeAll(
        app.chat_requests,
        async (deltaLike: any) => {
          const changes = Array.isArray(deltaLike)
            ? deltaLike
            : (deltaLike.delta ?? [])
          for (const change of changes) {
            if (change.item.status !== 'pending') continue
            dbB.insert(app.chat_responses, {
              request_id: change.item.request_id,
              response_text: `echo:${change.item.text}`,
              status: 'done',
              error: null,
              created_at: Date.now()
            })
          }
        }
      )
      unsubRequests =
        typeof maybeUnsubRequests === 'function'
          ? maybeUnsubRequests
          : await maybeUnsubRequests

      // Peer A: watch for the response
      const maybeUnsubResponses = dbA.subscribeAll(
        app.chat_responses,
        (deltaLike: any) => {
          const changes = Array.isArray(deltaLike)
            ? deltaLike
            : (deltaLike.delta ?? [])
          for (const change of changes) {
            if (change.item.request_id === 'req-rt-1') {
              received = change.item.response_text
            }
          }
        }
      )
      unsubResponses =
        typeof maybeUnsubResponses === 'function'
          ? maybeUnsubResponses
          : await maybeUnsubResponses

      // Peer A: insert the request
      dbA.insert(app.chat_requests, {
        request_id: 'req-rt-1',
        url: 'https://x',
        text: 'hello',
        prompt_type: 'edit-context',
        status: 'pending',
        created_at: Date.now()
      })

      await withTimeout('waitFor received', waitFor(() => received !== null))
      assert.equal(received, 'echo:hello')
    } finally {
      unsubResponses?.()
      unsubRequests?.()

      if (dbA) await dbA.shutdown?.().catch(() => undefined)
      if (dbB) await dbB.shutdown?.().catch(() => undefined)

      await withTimeout('server.stop', server.stop(), 3000).catch(() => undefined)

      try {
        rmSync(dbDirA, { recursive: true, force: true })
        rmSync(dbDirB, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
  }
)
