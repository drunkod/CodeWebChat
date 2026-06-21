import { test } from 'node:test'
import assert from 'node:assert/strict'

const RUN_ROUNDTRIP = process.env.CWC_RUN_JAZZ_ROUNDTRIP === '1'
const TEST_TIMEOUT_MS = Number(process.env.CWC_JAZZ_TEST_TIMEOUT_MS ?? 5000)

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

async function waitFor(cond: () => boolean, timeout = TEST_TIMEOUT_MS): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timed out')
    await sleep(10)
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

test(
  'two peers exchange request/response rows over the local server',
  {
    skip: RUN_ROUNDTRIP
      ? false
      : 'set CWC_RUN_JAZZ_ROUNDTRIP=1 to run real Jazz integration test'
  },
  async (t) => {
    t.signal?.throwIfAborted?.()

    const app = await withTimeout('import shared Jazz schema', loadSharedJazzApp())

    const { startLocalJazzServer } = await withTimeout(
      'import jazz-tools/dev',
      import('jazz-tools/dev') as Promise<{
        startLocalJazzServer?: (opts: Record<string, unknown>) => Promise<{
          appId: string
          port: number
          url: string
          stop: () => Promise<void>
        }>
      }>
    )

    if (!startLocalJazzServer) {
      t.skip('jazz-tools/dev does not export startLocalJazzServer')
      return
    }

    const server = await withTimeout(
      'startLocalJazzServer',
      startLocalJazzServer({ inMemory: true })
    )

    let unsubRequests: (() => void) | undefined
    let unsubResponses: (() => void) | undefined

    try {
      const [{ createJazzContext }, { createDb }] = await withTimeout(
        'import Jazz APIs',
        Promise.all([
          import('jazz-tools/backend') as Promise<{
            createJazzContext: (opts: Record<string, unknown>) => {
              asBackend: () => any
            }
          }>,
          import('jazz-tools') as Promise<{
            createDb: (opts: Record<string, unknown>) => Promise<any>
          }>
        ])
      )

      const permissions = {}

      const ctxA = createJazzContext({
        appId: server.appId,
        app,
        permissions,
        serverUrl: server.url,
        allowLocalFirstAuth: true,
        driver: { type: 'memory' }
      })
      const dbA = ctxA.asBackend()

      const dbB = await withTimeout(
        'createDb',
        createDb({
          appId: server.appId,
          serverUrl: server.url,
          driver: { type: 'memory' },
          secret: '0'.repeat(64)
        })
      )

      let received: string | null = null

      unsubRequests = await Promise.resolve(
        dbB.subscribeAll(
          app.chat_requests.where({ status: 'pending' }),
          async (delta: any) => {
            for (const change of delta.delta ?? delta) {
              await dbB.insert(app.chat_responses, {
                request_id: change.item.request_id,
                response_text: `echo:${change.item.text}`,
                status: 'done',
                error: null,
                created_at: Date.now()
              })
            }
          }
        )
      )

      unsubResponses = await Promise.resolve(
        dbA.subscribeAll(app.chat_responses, (delta: any) => {
          for (const change of delta.delta ?? delta) {
            if (change.item.request_id === 'req-1') {
              received = change.item.response_text
            }
          }
        })
      )

      await withTimeout(
        'insert chat request',
        dbA.insert(app.chat_requests, {
          request_id: 'req-1',
          url: 'https://x',
          text: 'hello',
          prompt_type: 'edit-context',
          status: 'pending',
          created_at: Date.now()
        })
      )

      await waitFor(() => received !== null)
      assert.equal(received, 'echo:hello')
    } finally {
      unsubResponses?.()
      unsubRequests?.()
      await withTimeout('server.stop', server.stop(), 1000).catch(() => undefined)
    }
  }
)
