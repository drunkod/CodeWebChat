import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JazzTransport } from './jazz-transport.js'

const config = { appId: 'app', port: 1625, dataDir: '.jazz/server', serverUrl: 'ws://localhost:1625' }

test('sendInitializeChat inserts a request and routes the matching response', async () => {
  const inserted: any[] = []
  let responseCb: ((d: any) => void) | null = null

  const fakeDb = {
    subscribeAll: (_q: unknown, cb: (d: any) => void) => { responseCb = cb; return () => {} },
    insert: async (_t: unknown, row: any) => { inserted.push(row); return row },
    shutdown: async () => {}
  }

  const t = new JazzTransport(config, async () => fakeDb)
  const applies: any[] = []
  t.onApplyResponse((m) => applies.push(m))
  await t.connect()

  t.sendInitializeChat({ action: 'initialize-chat', client_id: 7, text: 'hi', url: 'https://x' } as any)
  assert.equal(inserted.length, 1)
  const request_id = inserted[0].request_id

  responseCb!({ delta: [{ item: { request_id, response_text: 'REPLY', status: 'done' } }] })
  assert.equal(applies.length, 1)
  assert.equal(applies[0].client_id, 7)
  assert.equal(applies[0].response_text, 'REPLY')
})
