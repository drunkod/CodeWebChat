# Step 10 — Remote, security hardening, lifecycle

Once local is solid, the remote switch is mostly config. Then close the security
and lifecycle gaps the Jazz dev flagged.

## 10.1 Remote (Jazz Cloud or self-hosted edge)

Same schema, same code. Change `serverUrl` + auth:

```ts
// jazz-config.ts (remote variant)
const remote = {
  serverUrl: process.env.JAZZ_SERVER_URL ?? 'wss://v2.sync.jazz.tools/',
  appId: process.env.JAZZ_APP_ID!,        // from Jazz Cloud
  auth: 'jwt' as const
}
```

- **MCP server backend:** `createJazzContext({ ..., jwksUrl: process.env.JAZZ_JWKS_URL })`
  (or `jwtPublicKey`, not both), pass a `jwtToken`.
- **Extension:** `createDb({ appId, serverUrl, jwtToken })` instead of `secret`.
- **Manifest:** add `"wss://v2.sync.jazz.tools/*"` to `host_permissions`. WebSocket
  has no CORS preflight, but MV3 host permissions are still required.

Keep local-first for local and JWT for remote in the same codebase — switch by the
`jazz_mode` config (`local` → `secret` + localhost; `remote` → `jwtToken` + cloud).

## 10.2 Security — the 0.0.0.0 bind (same class as our host-mode bug)

The local sync server binds **all interfaces** with no loopback flag, and dev
local-first auth accepts any self-signed token. Mitigations:

```text
[ ] Use a non-guessable JAZZ_APP_ID (UUID), persisted to .jazz/app-id, never a name.
[ ] For anything beyond a trusted single machine, run NODE_ENV=production and
    external JWT so a random local process can't authenticate.
[ ] Firewall the Jazz port at the OS level (and bind the MCP host port to loopback).
[ ] Track upstream: ask the Jazz dev for a loopback-bind option; if added, use it.
```

> This mirrors the ChatGPT review's finding on `HostTransport` (binds without an
> explicit loopback host). Treat the Jazz port with the same caution.

## 10.3 Row lifecycle / cleanup

Rows accumulate; `db.delete()` is a **soft delete** (drops from live queries, stays
in history). Recommended:

```ts
// after a request/response pair completes, soft-delete both so they leave the
// pending/active subscriptions. Subscription cost scales with the matched set,
// so soft-deleting keeps live queries cheap regardless of history size.
await db.delete(app.chat_requests, requestRowId)
await db.delete(app.chat_responses, responseRowId)
```

Optionally a periodic sweeper deletes rows older than N minutes by
`created_at`/`$updatedAt`. Don't rely on hard delete (not app-facing).

## 10.4 Concurrency / claim safety

No atomic claim primitive — LWW on the `status` column. For a single extension
it's fine. If you ever run **two** extensions:

```text
[ ] Make onRequest idempotent (re-opening the same chatbot tab is safe).
[ ] Accept LWW: two claimers both flip status; last write wins; design so a
    double-answer is harmless (responses keyed by request_id; the registry takes
    the first matching response and ignores the rest).
```

## 10.5 Presence & timeouts

- Add the `presence` heartbeat (Step 4 §4.3 / Step 7 §7.3) so `ensureReady()` fails
  fast with `CWC_NO_BROWSER` instead of waiting for `CWC_TIMEOUT`.
- Keep the registry's `CWC_TIMEOUT` as the backstop if no response row arrives.

## 10.6 Pin & track alpha churn

```text
[ ] Pin the exact jazz-tools alpha version; upgrade deliberately.
[ ] startLocalJazzServer + the schema DSL are the most likely to change — they're
    isolated to jazz-sync-server.ts and schema.ts/permissions.ts, so a break is a
    one-file fix.
[ ] Re-run Step 6 integration test on every jazz-tools bump.
```

## Done when

- Remote works by flipping `serverUrl` + auth, no business-logic changes.
- The 0.0.0.0/auth caveats are mitigated and documented.
- A cleanup path keeps the request/response tables bounded.
- The plan is resilient to alpha churn (isolated wrappers, pinned version).
