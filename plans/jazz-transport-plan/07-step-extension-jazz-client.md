# Step 7 — Extension Jazz client (memory mode, MV3 background SW)

The extension subscribes to `chat_requests` and answers with `chat_responses`.
**Memory mode is mandatory** (persistent throws in an MV3 service worker).

## 7.1 The Jazz client module

`apps/browser/src/background/jazz-client.ts`:

```ts
import { createDb } from 'jazz-tools'
import { app } from '@shared/jazz/schema'
import type { ChatRequestRow } from '@shared/jazz/messages'

const APP_ID_KEY = 'cwc_jazz_app_id'
const SECRET_KEY = 'cwc_jazz_secret'

async function getOrCreate(key: string, make: () => string): Promise<string> {
  const got = await chrome.storage.local.get(key)
  if (typeof got[key] === 'string') return got[key]
  const value = make()
  await chrome.storage.local.set({ [key]: value })
  return value
}

export async function startJazzClient(opts: {
  serverUrl: string
  onRequest: (req: ChatRequestRow) => Promise<string> // returns the reply text
}) {
  // appId MUST match the MCP server's appId. For local dev, agree on it via a
  // shared env/config; here we read a value the MCP server also knows.
  const appId = await getOrCreate(APP_ID_KEY, () => DEFAULT_LOCAL_APP_ID)
  const secret = await getOrCreate(SECRET_KEY, () => crypto.randomUUID().replace(/-/g, '').padEnd(64, '0'))

  const db = await createDb({
    appId,
    serverUrl: opts.serverUrl,            // ws://localhost:1625
    secret,
    driver: { type: 'memory' }            // REQUIRED in MV3 SW
    // runtimeSources: { wasmUrl: chrome.runtime.getURL('jazz/jazz_wasm_bg.wasm') } // Step 8
  })

  // claim + answer each pending request (LWW on status; idempotent handler)
  const unsubscribe = db.subscribeAll(
    app.chat_requests.where({ status: 'pending' }),
    async ({ delta }: { delta: { item: ChatRequestRow }[] }) => {
      for (const ch of delta) {
        const req = ch.item
        // claim (best-effort; LWW — fine for a single extension)
        await db.update(app.chat_requests, req.id, { status: 'claimed' })
        try {
          const response_text = await opts.onRequest(req)
          await db.insert(app.chat_responses, {
            request_id: req.request_id, response_text, status: 'done', error: null, created_at: Date.now()
          }) // .wait({ tier: 'edge' }) // confirm the server got it
          await db.update(app.chat_requests, req.id, { status: 'done' })
        } catch (e) {
          await db.insert(app.chat_responses, {
            request_id: req.request_id, response_text: '', status: 'error',
            error: e instanceof Error ? e.message : String(e), created_at: Date.now()
          })
          await db.update(app.chat_requests, req.id, { status: 'failed' })
        }
      }
    }
  )

  return { db, unsubscribe }
}
```

> **Why memory mode is safe here:** the Node backend is the durable store. If the
> SW is killed mid-request, on restart the client reconnects and the subscription
> **replays** the still-`pending`/`claimed` rows, so the request isn't lost. Make
> `onRequest` idempotent (re-opening the same chatbot tab is fine).

## 7.2 Wire it into the background entrypoint (behind a flag)

`apps/browser/src/background/main.ts` (sketch):

```ts
import { startJazzClient } from './jazz-client'
import { connect_websocket } from './websocket' // legacy fallback
import { driveChatbotAndCaptureReply } from './capture' // Step 8

async function init() {
  if (await isJazzTransportEnabled()) {           // feature flag (storage/setting)
    await startJazzClient({
      serverUrl: JAZZ_SERVER_URL,                 // ws://localhost:1625
      onRequest: async (req) => driveChatbotAndCaptureReply(req)
    })
  } else {
    connect_websocket()                           // current behavior
  }
  setup_keep_alive()
  setup_message_listeners()
}
```

## 7.3 Heartbeat/presence (optional, pairs with Step 4 §4.3)

If you added a `presence` table, write a row every ~5s so the Node side's
`ensureReady()` knows a browser is live:

```ts
setInterval(() => { void db.insert(app.presence, { kind: 'browser', at: Date.now() }) }, 5000)
```

## Done when

- The background SW creates a **memory-mode** Jazz client without throwing.
- It subscribes to `chat_requests(status='pending')` and, for each, calls
  `onRequest` and writes a `chat_responses` row.
- Feature-flagged: with the flag off, the legacy WebSocket client runs unchanged.
