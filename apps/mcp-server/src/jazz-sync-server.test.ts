import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startSyncServerSafe } from './jazz-sync-server.js'

test('startSyncServerSafe surfaces missing jazz-tools as a loader error', async () => {
  await assert.rejects(
    async () =>
      startSyncServerSafe({
        appId: 'app',
        port: -1,
        dataDir: '.jazz/server',
        serverUrl: 'ws://localhost:-1'
      }),
    /Cannot find package 'jazz-tools'|does not export startLocalJazzServer|Invalid DevServer options/
  )
})
