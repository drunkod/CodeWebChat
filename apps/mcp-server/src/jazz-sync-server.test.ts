import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startSyncServerSafe } from './jazz-sync-server.js'

test('startSyncServerSafe configures server options and stops cleanly', async () => {
  // Use a different port to avoid conflict with running instances
  const handle = await startSyncServerSafe({
    appId: 'test-sync-server',
    port: 1999,
    dataDir: '.jazz/test-server',
    serverUrl: 'ws://localhost:1999'
  })

  assert.equal(handle.appId, 'test-sync-server')
  assert.equal(handle.port, 1999)
  assert.ok(typeof handle.stop === 'function')

  // Tear down cleanly
  await handle.stop()
})

// This test checks whether the installed jazz-napi binary exposes the HTTP
// schema-admin endpoint required for cross-peer table sync (pushSchemaCatalogue).
// Until this passes, the roundtrip integration test (CWC_RUN_JAZZ_ROUNDTRIP=1)
// will always time out — cross-peer subscription routing requires schema publication.
const RUN_SCHEMA_ADMIN_CHECK = process.env.CWC_RUN_JAZZ_SCHEMA_ADMIN_CHECK === '1'

test(
  'local Jazz server exposes HTTP schema admin endpoint',
  {
    skip: RUN_SCHEMA_ADMIN_CHECK
      ? false
      : 'set CWC_RUN_JAZZ_SCHEMA_ADMIN_CHECK=1 to check Jazz schema-admin support (fails on alpha.51)'
  },
  async () => {
    const { startLocalJazzServer } = (await import('jazz-tools/dev')) as any
    const server = await startLocalJazzServer({
      inMemory: true,
      adminSecret: 'check-admin'
    })

    try {
      const url = `${server.url}/apps/${encodeURIComponent(server.appId)}/admin/schemas`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Jazz-Admin-Secret': 'check-admin'
        },
        body: JSON.stringify({ schema: {} })
      })

      assert.notEqual(
        res.status,
        404,
        `Jazz local server returned 404 for schema admin endpoint — cross-peer sync will not work with this jazz-napi version`
      )
    } finally {
      await server.stop()
    }
  }
)
