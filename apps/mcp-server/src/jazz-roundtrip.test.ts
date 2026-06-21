import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../../packages/shared/dist/jazz/schema.js'

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(cond: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timed out')
    await sleep(10)
  }
}

let startLocalJazzServer:
  | undefined
  | ((opts: Record<string, unknown>) => Promise<{
      appId: string
      port: number
      url: string
      stop: () => Promise<void>
    }>)

before(async () => {
  const mod = await import('jazz-tools/dev')
  startLocalJazzServer = mod.startLocalJazzServer as typeof startLocalJazzServer
})

after(async () => {
  startLocalJazzServer = undefined
})

test('two peers exchange request/response rows over the local server', async (t) => {
  t.signal?.throwIfAborted?.()
  if (!startLocalJazzServer) {
    t.skip('jazz-tools/dev is not installed')
    return
  }

  const server = await startLocalJazzServer({ inMemory: true })
  try {
    const { createJazzContext } = await import('jazz-tools/backend')
    const { createDb } = await import('jazz-tools')

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

    const dbB = await createDb({
      appId: server.appId,
      serverUrl: server.url,
      driver: { type: 'memory' },
      secret: '0'.repeat(64)
    })

    let received: string | null = null

    const unsubRequests = dbB.subscribeAll(
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

    const unsubResponses = dbA.subscribeAll(
      app.chat_responses,
      (delta: any) => {
        for (const change of delta.delta ?? delta) {
          if (change.item.request_id === 'req-1') {
            received = change.item.response_text
          }
        }
      }
    )

    await dbA.insert(app.chat_requests, {
      request_id: 'req-1',
      url: 'https://x',
      text: 'hello',
      prompt_type: 'edit-context',
      status: 'pending',
      created_at: Date.now()
    })

    await waitFor(() => received !== null)
    assert.equal(received, 'echo:hello')

    unsubRequests()
    unsubResponses()
  } finally {
    await server.stop()
  }
})
