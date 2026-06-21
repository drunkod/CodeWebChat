# Jazz integration — local first, then remote

The only differences between local and remote are **`serverUrl`** and the **auth
mode**. Build and validate everything locally first.

## Phase L — Local (self-hosted sync server on localhost) ⭐ priority

### L1. Run a local Jazz sync server

```bash
# one process, persistent storage, dev/local-first auth on by default
npx jazz-tools@alpha server "$JAZZ_APP_ID" --port 1625 --data-dir ./.jazz/server
# or ephemeral:
npx jazz-tools@alpha server "$JAZZ_APP_ID" --port 1625 --in-memory
```

Both peers then use `serverUrl: "ws://localhost:1625"` (confirm ws vs http scheme
with the dev). In dev, local-first auth is enabled by default, so no JWKS/JWT is
required — each peer just needs a `secret` (device identity) and to share a Group.

> Where does the server run? Options to confirm (Q in `03-...`): a standalone
> process the user starts, **or** spawned as a child of the `cwc-mcp-server` so
> "start the MCP server" also brings up local sync. The latter is the smoothest UX
> (one thing to run), mirroring how the host-mode server self-contains the relay.

### L2. Publish the schema

In dev, the bundler dev-plugin auto-pushes `schema.ts`/`permissions.ts` on change.
For the Node MCP server (no bundler), confirm the equivalent: either
`jazz-tools deploy <appId>` or structural auto-sync against the dev server.

### L3. Wire both peers to localhost

- MCP server: `JAZZ_SERVER_URL=ws://localhost:1625`, `allowLocalFirstAuth: true`.
- Extension: `createDb({ appId, secret, serverUrl: 'ws://localhost:1625' })`.

### L4. Local acceptance test (the heartbeat)

```
[ ] Local sync server running on :1625.
[ ] MCP server connected (backend context) and extension client connected.
[ ] MCP inserts a chat_requests row → extension's subscription fires.
[ ] Extension drives the chatbot, captures reply, inserts chat_responses row.
[ ] MCP's subscription returns response_text. No clipboard, no port 55155.
[ ] Kill the network/internet — local loop still works (it's all localhost).
```

That last line is the whole point: **local communication needs no internet.**

## Phase R — Remote (Jazz Cloud or remote self-hosted edge)

Same schema, same insert/subscribe code. Change two things:

### R1. `serverUrl`
- Jazz Cloud: `https://v2.sync.jazz.tools/` (get an `appId` from Jazz Cloud).
- Self-hosted remote edge: run the server with `--upstream-url` (edge→core), point
  `serverUrl` at it.

### R2. Auth (production)
Local-first auth is fine for local/solo; for remote multi-user, switch to
**external JWT**: run the sync server with `--jwks-url` (or `--jwt-public-key`),
have each peer pass `jwtToken`. The MCP server backend uses `jwksUrl` on
`createJazzContext`. (Your research report's auth matrix recommends *external JWT +
short-lived backend-minted tokens*.)

### R3. "Prefer local" switch
A single config selects the transport/target:

```ts
const target =
  config.jazz_mode === 'remote'
    ? { serverUrl: REMOTE_URL, auth: 'jwt' }
    : { serverUrl: 'ws://localhost:1625', auth: 'local-first' }  // default
```

Local is the default; remote is opt-in. If the local sync server isn't reachable,
you may fall back to remote, or to the legacy WS bridge (see rollback).

## Migration & rollback (don't rip out the WS bridge yet)

1. **Add, don't replace.** Introduce a `--transport jazz|ws` flag on
   `cwc-mcp-server` (default `ws` until Jazz is proven), and a matching
   feature-flag in the extension background worker.
2. Keep `HostTransport` (the WS relay) and the clipboard path intact as the
   fallback adapter. The research report's rollback switch:
   ```ts
   if (settings.transport !== 'jazz') return wsAdapter
   return jazzAdapter
   ```
3. Ship the Jazz path behind the flag; flip the default to `jazz` only after the
   L4 acceptance test passes and the MV3 client question (Q1) is resolved.
4. On severe failure: flip the flag back to `ws`, and `db.logout({ wipeData: true })`
   to reset extension-side Jazz storage.

## Config summary

| Concern | Local (default) | Remote |
| --- | --- | --- |
| `serverUrl` | `ws://localhost:1625` | `https://v2.sync.jazz.tools/` or self-hosted edge |
| Auth | local-first (`secret`) | external JWT (`jwtToken` + JWKS) |
| Internet required | no | yes |
| Sync server | self-hosted localhost (own/child process) | Jazz Cloud or remote edge |
| Durability tier for "sent" | `local` (instant) | `edge` (confirm it left the device) |
| Clipboard | removed (row carries text) | removed |
| WS bridge / 55155 | fallback only | fallback only |
