# Step 6 — Node-side tests

Two layers: a **fast unit test** with a fake Jazz `db` (no native runtime), and an
**integration test** against a real embedded sync server (`startLocalJazzServer`).

## 6.1 Unit: `JazzTransport` routing (fake db)

`apps/mcp-server/src/jazz-transport.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Inject a fake db by subclassing or by a small seam. Simplest: extract a
// `createBackendDb(config)` factory and stub it. Here we drive the public surface.

test('sendInitializeChat inserts a request and routes the matching response', async () => {
  const inserted: any[] = []
  let responseCb: ((d: any) => void) | null = null

  const fakeDb = {
    subscribeAll: (_q: unknown, cb: (d: any) => void) => { responseCb = cb; return () => {} },
    insert: async (_t: unknown, row: any) => { inserted.push(row); return row },
    shutdown: async () => {}
  }

  // A JazzTransport variant that uses the injected db (see §6.3 seam).
  const t = makeJazzTransportWithDb(fakeDb)
  const applies: any[] = []
  t.onApplyResponse((m) => applies.push(m))
  await t.connect()

  // registry would call this with client_id 7
  t.sendInitializeChat({ action: 'initialize-chat', client_id: 7, text: 'hi', url: 'https://x' } as any)
  assert.equal(inserted.length, 1)
  const request_id = inserted[0].request_id

  // simulate the extension writing a response row
  responseCb!({ delta: [{ item: { request_id, response_text: 'REPLY', status: 'done' } }] })
  assert.equal(applies.length, 1)
  assert.equal(applies[0].client_id, 7)            // echoed back for the registry
  assert.equal(applies[0].response_text, 'REPLY')  // inline reply
})
```

## 6.2 Integration: real embedded sync server (two db handles)

`apps/mcp-server/src/jazz-roundtrip.test.ts`:

```ts
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startLocalJazzServer } from 'jazz-tools/dev'
import { createJazzContext } from 'jazz-tools/backend'
import { createDb } from 'jazz-tools'
import { app } from '@shared/jazz/schema.js'
import permissions from '@shared/jazz/permissions.js'

let server: Awaited<ReturnType<typeof startLocalJazzServer>>

before(async () => {
  server = await startLocalJazzServer({ inMemory: true }) // random free port
})
after(async () => { await server.stop() })

test('two peers exchange request/response rows over the local server', async () => {
  // peer A = "MCP server" backend
  const ctxA = createJazzContext({
    appId: server.appId, app, permissions,
    serverUrl: server.url, allowLocalFirstAuth: true,
    driver: { type: 'memory' }   // memory is fine for the test
  })
  const dbA = ctxA.asBackend()

  // peer B = "extension" client (memory mode, like MV3)
  const dbB = await createDb({
    appId: server.appId, serverUrl: server.url, driver: { type: 'memory' },
    secret: '0'.repeat(64) // fixed test secret
  })

  // B subscribes to pending requests, answers them
  const unsub = dbB.subscribeAll(app.chat_requests.where({ status: 'pending' }), async ({ delta }) => {
    for (const ch of delta) {
      const r = ch.item
      await dbB.insert(app.chat_responses, {
        request_id: r.request_id, response_text: `echo:${r.text}`, status: 'done', error: null, created_at: Date.now()
      })
    }
  })

  // A waits for the response
  const got = new Promise<string>((resolve) => {
    dbA.subscribeAll(app.chat_responses, ({ delta }) => {
      for (const ch of delta) if (ch.item.request_id === 'req-1') resolve(ch.item.response_text)
    })
  })

  await dbA.insert(app.chat_requests, {
    request_id: 'req-1', url: 'https://x', text: 'hello', prompt_type: 'edit-context',
    status: 'pending', created_at: Date.now()
  })

  assert.equal(await got, 'echo:hello')
  unsub()
})
```

> This is the **real proof** the architecture works: two independent Jazz handles
> talk through the local server with no clipboard, no WS relay. If this passes, the
> Node half is sound and only the extension packaging (Step 7–8) remains.

## 6.3 Test seam for the fake-db unit test

To inject a fake db, extract the context creation behind a factory the constructor
accepts:

```ts
// jazz-transport.ts
export type BackendDbFactory = (config: JazzConfig) => Promise<any>
constructor(private config: JazzConfig, private makeDb: BackendDbFactory = defaultMakeDb) {}
// connect(): this.db = await this.makeDb(this.config)
```

Then `makeJazzTransportWithDb(fakeDb)` passes `async () => fakeDb`.

## 6.4 Run

```bash
nix develop path:/Users/test/Documents/work/CodeWebChat --command pnpm --filter cwc-mcp-server test
```

## Done when

- Unit test green (routing + inline reply, no native runtime).
- Integration round-trip green against a real embedded server.
- Existing 15 tests still pass (`--transport ws` untouched).
