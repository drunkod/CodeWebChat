# Step 5 — Wire `index.ts`: `--transport jazz|ws`, spawn server, prefer inline reply (clipboard retained)

Select the transport at startup, spawn the local sync server when `jazz`, and let
the **reply text come from the response row when available, falling back to the
clipboard**. Clipboard support is **kept**, not removed.

## 5.1 Inline reply + clipboard fallback (both supported)

`RequestRegistry.run()` reads the OS clipboard after `apply`. With Jazz the reply
may already be in the apply message (`response_text`). Add an optional field to the
apply message and have the registry **prefer it when present, otherwise fall back
to the clipboard** (controlled by `use_clipboard_fallback`, default `true`).

### 5.2 Protocol: optional `response_text` on the apply message

`apps/mcp-server/src/protocol.ts` — add to `ApplyChatResponseMessage`:

```ts
export type ApplyChatResponseMessage = {
  action: 'apply-chat-response'
  client_id: number
  request_id?: string
  response_text?: string // NEW: reply carried inline (Jazz transport sets this)
  raw_instructions?: string
  edit_format?: string
  url?: string
}
```

### 5.3 Registry: prefer `response_text`, fall back to clipboard

`apps/mcp-server/src/request-registry.ts` — in `run()`, after `await apply_promise`:

```ts
const apply = await apply_promise
// Jazz transport: reply is inline → no clipboard.
if (typeof apply.response_text === 'string' && apply.response_text.trim()) {
  return apply.response_text
}
// WS/host transport: fall back to the clipboard (existing behavior).
await sleep(this.clipboard_read_delay_ms)
const after_clipboard = await this.read_clipboard()
// ...existing empty/unchanged guards...
return after_clipboard
```

> `waitForApply` already resolves with the apply message; just thread
> `response_text` through. The WS path leaves it undefined → clipboard fallback,
> so **nothing breaks** for `--transport ws`.

And in `JazzTransport` (Step 4 §4.2), set it when synthesizing the apply:

```ts
this.apply_handler({
  action: 'apply-chat-response',
  client_id,
  request_id: row.request_id,
  response_text: row.response_text // ← the reply, straight from the Jazz row
})
```

## 5.4 `index.ts` — select transport + spawn server

```ts
import { parseTransportKind } from './transport-mode.js'
import { resolveJazzConfig } from './jazz-config.js'
import { ensureSyncServer } from './jazz-sync-server.js'
import { JazzTransport } from './jazz-transport.js'
// ...existing imports (ClientTransport, HostTransport, RequestRegistry, etc.)

const transportKind = parseTransportKind(process.argv.slice(2))

let cwcTransport
let syncServerHandle: Awaited<ReturnType<typeof ensureSyncServer>> = null

if (transportKind === 'jazz') {
  const jazzConfig = resolveJazzConfig()
  syncServerHandle = await ensureSyncServer(jazzConfig) // spawn local sync (or external)
  cwcTransport = new JazzTransport(jazzConfig)
} else {
  // existing path
  cwcTransport = mode === 'host' ? new HostTransport() : new ClientTransport()
}

const registry = new RequestRegistry(cwcTransport, readSystemClipboard)
const reviewHandoff = new ReviewHandoff(registry, realGitRunner)
// ...the rest is unchanged: tools call the registry, which calls the transport.
```

## 5.5 Mode-aware instructions

Reflect the transport in the server `instructions` so the model/user knows the
channel:

```ts
const channel =
  transportKind === 'jazz'
    ? 'Transport: Jazz (local sync). The reply is delivered in a synced row; no clipboard.'
    : 'Transport: WebSocket relay on 55155; reply via the OS clipboard after Apply.'
const instructions = `${CWC_MCP_INSTRUCTIONS} ${channel}`
```

## 5.6 Clean shutdown

`ensureSyncServer` already registers SIGINT/SIGTERM stop (Step 3). Also close the
transport on shutdown:

```ts
const shutdown = async () => {
  await cwcTransport.close().catch(() => {})
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
```

## Done when

- `node dist/index.js --transport ws` behaves exactly as today (clipboard path).
- `node dist/index.js --transport jazz` spawns the local sync server and uses
  `JazzTransport`.
- `request_review` / `send_to_codewebchat` need **no changes** — they go through
  the registry, which now prefers `response_text` when present.
