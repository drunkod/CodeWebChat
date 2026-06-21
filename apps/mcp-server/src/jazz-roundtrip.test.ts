import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

let startLocalJazzServer:
  | undefined
  | ((
      opts: Record<string, unknown>
    ) => Promise<{
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
  if (!startLocalJazzServer) {
    t.skip('jazz-tools/dev is not installed')
    return
  }

  const server = await startLocalJazzServer({ inMemory: true })
  try {
    const { createJazzContext } = await import('jazz-tools/backend')
    const { createDb } = await import('jazz-tools')

    const app = {
      chat_requests: 'chat_requests',
      chat_responses: 'chat_responses'
    } as const
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

    const unsub = dbB.subscribeAll(
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

    const got = new Promise<string>((resolve) => {
      dbA.subscribeAll(app.chat_responses, (delta: any) => {
        for (const change of delta.delta ?? delta) {
          if (change.item.request_id === 'req-1')
            resolve(change.item.response_text)
        }
      })
    })

    await dbA.insert(app.chat_requests, {
      request_id: 'req-1',
      url: 'https://x',
      text: 'hello',
      prompt_type: 'edit-context',
      status: 'pending',
      created_at: Date.now()
    })

    assert.equal(await got, 'echo:hello')
    unsub()
  } finally {
    await server.stop()
  }
})
