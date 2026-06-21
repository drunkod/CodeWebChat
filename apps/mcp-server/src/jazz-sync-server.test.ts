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
