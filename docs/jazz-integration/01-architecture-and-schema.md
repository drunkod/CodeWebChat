# Jazz integration — architecture, schema, and the two peers

> ⚠️ **Updated by the Jazz dev's answers — see `04-resolved-architecture.md`.**
> Two corrections to what's below: (1) the extension **cannot** use persistent
> mode in an MV3 service worker — it **must** use `driver: { type: 'memory' }` +
> `serverUrl`; (2) there is **no "Group"** in Jazz 2.0 — peers share data via the
> same `appId` + **row-level permissions** (`allow*.always()` for the private
> channel). The `04` doc is the authoritative design.

All code here is **illustrative** — the *shape* of the integration. The exact,
confirmed decisions live in `04`.

## Players

| Peer | Jazz role | Setup API | Lives in |
| --- | --- | --- | --- |
| MCP server (Node) | **backend context** | `createJazzContext({...})` → `context.asBackend()` | `apps/mcp-server` |
| Chrome extension (background SW) | **client** | `createDb({ appId, secret, serverUrl })` | `apps/browser/src/background` |
| Sync server | **edge** | `npx jazz-tools@alpha server <appId> --port 1625` | local process (or cloud) |

Both peers must share a **Group** (Jazz's permission unit) so each can read the
other's rows. See `03-...` Q on the simplest headless sharing pattern.

## 1. Shared schema (`schema.ts`, published to the sync server)

A two-table request/response channel (one row per prompt, one row per reply):

```ts
// schema.ts (shared; the sync server holds the structural schema)
import { defineApp, table, column as c } from 'jazz-tools/schema' // shape TBD — confirm DSL

export const app = defineApp({
  chat_requests: table({
    request_id: c.text(),          // correlation id (uuid)
    url: c.text(),                 // chatbot URL
    text: c.text(),                // the prompt
    prompt_type: c.text(),         // 'edit-context' etc.
    status: c.text(),              // 'pending' | 'sent' | 'done' | 'failed'
    created_at: c.timestamp()
  }),
  chat_responses: table({
    request_id: c.text(),          // matches chat_requests.request_id
    response_text: c.text(),       // THE REPLY — no clipboard needed
    status: c.text(),              // 'done' | 'error'
    error: c.text().nullable(),
    created_at: c.timestamp()
  })
})
```

> The reply lives in `chat_responses.response_text`. That single column is what
> retires the OS clipboard from the whole design.

## 2. MCP server side (backend context)

Replaces `HostTransport` with a Jazz-backed transport that implements the same
`CwcTransport`-style contract, so `RequestRegistry` / the review tools are
unchanged.

```ts
// apps/mcp-server/src/jazz-transport.ts (sketch)
import { createJazzContext } from 'jazz-tools/backend'
import { app } from './schema.js'

const context = createJazzContext({
  appId: process.env.JAZZ_APP_ID!,
  app,
  permissions,                       // permissions.ts
  driver: { type: 'persistent', dataPath: './.jazz/mcp.db' },
  serverUrl: process.env.JAZZ_SERVER_URL ?? 'ws://localhost:1625', // LOCAL default
  allowLocalFirstAuth: true          // local dev: no external IdP
})
const db = context.asBackend()

// send a prompt = insert a request row (wait for the edge so we know it synced)
export async function sendPrompt(req: { request_id: string; url: string; text: string; prompt_type: string }) {
  await db.insert(app.chat_requests, { ...req, status: 'pending', created_at: Date.now() })
    // .wait({ tier: 'edge' })  // confirm the sync server has the command row
}

// receive = subscribe to the matching response row
export function onResponse(request_id: string, cb: (text: string) => void) {
  return db.subscribeAll(
    app.chat_responses.where({ request_id }),
    ({ all }) => { if (all[0]) cb(all[0].response_text) }
  )
}
```

The `RequestRegistry` ticket model maps cleanly: `begin()` inserts a request row;
`poll()` reads the `chat_responses` subscription for that `request_id`. The whole
"clipboard before/after guard" disappears.

## 3. Chrome extension side (client, in the background service worker)

```ts
// apps/browser/src/background/jazz.ts (sketch)
import { createDb, BrowserAuthSecretStore } from 'jazz-tools'
import { app } from '@shared/schema'

const secret = await BrowserAuthSecretStore.getOrCreateSecret({ appId: APP_ID })
const db = await createDb({
  appId: APP_ID,
  secret,                                   // device identity (persist in chrome.storage.local)
  serverUrl: 'ws://localhost:1625',         // LOCAL default; remote later
  driver: { type: 'memory' }                // REQUIRED in MV3 SW: persistent mode throws
                                            // (no SharedWorker/Web Locks/OPFS). See 04.
})

// react to new prompt requests
db.subscribeAll(app.chat_requests.where({ status: 'pending' }), async ({ all }) => {
  for (const reqRow of all) {
    await openChatbotAndFill(reqRow.url, reqRow.text)   // existing CWC automation
    // when the chatbot reply is captured (DOM extract or Apply click):
    const response_text = await captureReply()
    await db.insert(app.chat_responses, {
      request_id: reqRow.request_id, response_text, status: 'done', created_at: Date.now()
    })
    await db.update(app.chat_requests, reqRow.id, { status: 'done' })
  }
})
```

The content scripts stay as-is (DOM automation only); the background worker swaps
its WebSocket client for the Jazz client.

## 4. The flow, end to end

```
1. MCP tool call → db.insert(chat_requests, {request_id, url, text, status:'pending'})
2. (sync) → extension's subscribe(chat_requests where status='pending') fires
3. extension opens chatbot, fills prompt, waits for reply, captures response_text
4. extension db.insert(chat_responses, {request_id, response_text, status:'done'})
5. (sync) → MCP's subscribe(chat_responses where request_id=...) fires → returns text
```

No port 55155, no `gemini-coder` token, no clipboard. Correlation is the
`request_id` column (Jazz handles delivery/offline/reconnect).

## 5. MV3 client host — RESOLVED ✅ (use memory mode)

The make-or-break question is answered: the Jazz **persistent** client **cannot**
run in an MV3 service worker (it requires SharedWorker + MessageChannel + Web
Locks; OPFS needs a dedicated worker — none exist in an MV3 SW, and `createDb()`
throws). **Use `driver: { type: 'memory' }` + `serverUrl`** (as in the code
above). Memory mode skips OPFS/worker and syncs the SW global directly with the
localhost server; on SW kill/restart it reconnects and subscriptions replay. The
**Node backend is the durable store**. Full detail + sources in
`04-resolved-architecture.md`.

## 6. What stays / what changes

| Component | Change |
| --- | --- |
| `cwc-mcp-server` host transport | Add `JazzTransport` (insert/subscribe). Keep `HostTransport` (WS) as a fallback adapter behind a `--transport jazz\|ws` flag. |
| `RequestRegistry` / review tools | Unchanged — they call the transport contract. |
| `apps/browser/.../background/websocket.ts` | Replace WS client with Jazz client (or add `jazz.ts` and feature-flag). |
| content scripts | Unchanged (DOM automation). The `response_text` capture replaces the clipboard copy on Apply. |
| `packages/shared` | Add the Jazz `schema.ts` + `permissions.ts` (shared by both peers). |
| OS clipboard / `clipboardy` | Removed from the response path. |
