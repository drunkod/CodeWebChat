# Step 3 — Local sync server (spawned by the MCP server)

Wrap `startLocalJazzServer()` so "start the MCP server" also brings up the local
Jazz sync server — the same embedded pattern the Jazz Vite/Next plugins use. One
wrapper file isolates the alpha dev-helper API.

## 3.1 The wrapper

`apps/mcp-server/src/jazz-sync-server.ts`:

```ts
import { startLocalJazzServer } from 'jazz-tools/dev' // confirm export path
import type { JazzConfig } from './jazz-config.js'

export type SyncServerHandle = {
  url: string
  port: number
  appId: string
  stop: () => Promise<void>
}

/**
 * Start an embedded local Jazz sync server. Idempotent-ish: callers should hold
 * the returned handle for the process lifetime and stop() on shutdown.
 *
 * NOTE: the server binds 0.0.0.0 (all interfaces) — there is no loopback-only
 * flag today. Mitigate with a non-guessable appId + OS firewall (see Step 10).
 */
export async function startSyncServer(config: JazzConfig): Promise<SyncServerHandle> {
  const server = await startLocalJazzServer({
    appId: config.appId,
    port: config.port,
    dataDir: config.dataDir,
    // allowLocalFirstAuth defaults true in dev; keep local-first for the local channel
    enableLogs: process.env.JAZZ_DEBUG === '1'
  })
  return {
    url: server.url,         // e.g. ws://127.0.0.1:1625
    port: server.port,
    appId: server.appId,
    stop: server.stop
  }
}
```

## 3.2 Port-in-use handling (we've been here before)

Like host mode's 55155, two servers can't bind the same Jazz port. Wrap the start
so a clash is a clear error, not a crash:

```ts
export async function startSyncServerSafe(config: JazzConfig): Promise<SyncServerHandle> {
  try {
    return await startSyncServer(config)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (/EADDRINUSE|in use|address already/i.test(msg)) {
      throw new Error(
        `Jazz sync port ${config.port} is already in use. ` +
          `Another cwc-mcp-server (or a stray jazz server) may be running. ` +
          `Stop it, or set JAZZ_PORT to a free port.`
      )
    }
    throw error
  }
}
```

> Let `startLocalJazzServer` pick a **random free port** (omit `port`) in tests so
> parallel test runs don't collide — the handle returns the actual `port`/`url`.

## 3.3 Lifecycle: stop on shutdown

Register cleanup so the child server doesn't linger (the analogue of unref'ing the
ping timer / awaiting close in host mode):

```ts
export function registerSyncServerShutdown(handle: SyncServerHandle): void {
  const stop = () => { void handle.stop().catch(() => undefined) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  process.once('beforeExit', stop)
}
```

## 3.4 Optional: connect to an already-running server

If the user runs `npx jazz-tools@alpha server <appId> --port 1625` themselves (or a
shared instance), skip spawning and just use `serverUrl`. Gate on an env flag:

```ts
export async function ensureSyncServer(config: JazzConfig): Promise<SyncServerHandle | null> {
  if (process.env.JAZZ_EXTERNAL_SERVER === '1') {
    return null // assume serverUrl points at an existing server; don't spawn
  }
  const handle = await startSyncServerSafe(config)
  registerSyncServerShutdown(handle)
  return handle
}
```

## Done when

- `ensureSyncServer(config)` starts a server (or returns null for external) and a
  later `stop()` releases the port.
- A second start on the same fixed port reports the friendly "port in use" error.
- In tests, omitting `port` yields a random free port and a usable `url`.
