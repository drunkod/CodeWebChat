# Jazz transport plan — START HERE

Add a **Jazz v2** request/response channel as an _additional_ transport alongside
the existing `localhost:55155` WebSocket relay: the MCP server inserts a
`chat_requests` row, the extension subscribes and writes a `chat_responses` row
(the reply text can ride in the row). **Clipboard support is retained** — it stays
as a first-class capture/return path, not something this plan removes (see
"Clipboard policy" below). **Local-first** (a localhost Jazz sync server
spawned by the MCP server); remote later via `serverUrl` + JWT.

Design rationale and the Jazz-dev answers: `docs/jazz-integration/` (esp.
`04-resolved-architecture.md`). This folder is the executable, code-complete plan.

## The architecture (resolved)

```
Node MCP server (apps/mcp-server)
  ├─ startLocalJazzServer({ appId, port, dataDir })          // spawn local sync (child)
  ├─ createJazzContext({ driver:'persistent', serverUrl:'ws://localhost:PORT' })  ← durable store
  └─ JazzTransport (implements CwcTransport): insert chat_requests · subscribe chat_responses
        ▲ ws://localhost:PORT (no internet)
        ▼
Chrome extension background SW (apps/browser)
  └─ createDb({ driver:{type:'memory'}, serverUrl, secret })  // memory mode (MV3 SW)
       subscribe chat_requests(status='pending') → drive chatbot → insert chat_responses(response_text)
```

## Non-negotiable facts (from the Jazz source)

- Extension **must** use `driver: { type: 'memory' }` — persistent mode throws in
  an MV3 service worker (no SharedWorker/Web Locks/OPFS).
- **No "Group"** in Jazz 2.0 — share via the same `appId` + **row-level
  permissions** (`allow*.always()` for this private local channel).
- **No P2P** — both peers connect to a localhost sync server; spawn it with
  `startLocalJazzServer()`.
- `db.delete()` is a **soft delete**; subscription cost scales with the matched set.
- The reply text can travel in `chat_responses.response_text` (inline) **and/or**
  via the clipboard — both are supported. Jazz adds the inline option; it does not
  remove the clipboard.

## Clipboard policy (decision — do NOT remove clipboard)

Clipboard support is **retained as a first-class path** across all transports:

- **WS transport:** reply continues to come via the OS clipboard after Apply (unchanged).
- **Jazz transport:** the reply may be carried inline in `chat_responses.response_text`,
  **or** captured via the clipboard, whichever the extension provides. The registry
  prefers an inline `response_text` when present and **falls back to the clipboard**;
  it never drops clipboard support.
- The `RequestRegistry` `use_clipboard_fallback` option defaults to **true**. Leave it
  on. Set it to `false` only for a deliberate inline-only test — never as the default.
- DOM-based reply extraction (`get_latest_reply_text()`) is an **optional addition**,
  not a replacement for the clipboard.

Acceptance does **not** require a clipboard-free path. "Reply returns correctly"
(by clipboard or inline row) is the goal.

## Steps (build top to bottom)

| Step | File                                                                                     | What                                                               |
| ---- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1    | [`01-step-deps-and-config.md`](01-step-deps-and-config.md)                               | Add `jazz-tools`; app id, port, env, `--transport` flag plumbing   |
| 2    | [`02-step-shared-schema-and-permissions.md`](02-step-shared-schema-and-permissions.md)   | `schema.ts` + `permissions.ts` (chat_requests/chat_responses)      |
| 3    | [`03-step-local-sync-server.md`](03-step-local-sync-server.md)                           | `jazz-sync-server.ts` — spawn/stop the local sync server           |
| 4    | [`04-step-jazz-transport-node.md`](04-step-jazz-transport-node.md)                       | `jazz-transport.ts` implementing `CwcTransport` over Jazz rows     |
| 5    | [`05-step-wire-index-transport-flag.md`](05-step-wire-index-transport-flag.md)           | `index.ts`: `--transport jazz\|ws`, spawn server, select transport |
| 6    | [`06-step-node-tests.md`](06-step-node-tests.md)                                         | Unit + integration tests for the Node half (fake/real Jazz)        |
| 7    | [`07-step-extension-jazz-client.md`](07-step-extension-jazz-client.md)                   | `apps/browser` background: memory-mode client, subscribe/insert    |
| 8    | [`08-step-extension-capture-and-manifest.md`](08-step-extension-capture-and-manifest.md) | Capture reply→`response_text`; manifest/CSP; feature flag          |
| 9    | [`09-step-local-acceptance-and-rollback.md`](09-step-local-acceptance-and-rollback.md)   | End-to-end local test, then flip default; rollback to WS           |
| 10   | [`10-step-remote-and-hardening.md`](10-step-remote-and-hardening.md)                     | Remote (cloud/JWT); security (0.0.0.0 caveat); cleanup/TTL         |

## Where to start & guardrails

- Build the **Node half first (steps 1–6)** — it's lower risk (native runtime, no
  MV3). Keep everything behind **`--transport jazz|ws`, default `ws`**; never
  remove `HostTransport`/`ClientTransport` — they stay as the fallback.
- The `CwcTransport` interface is unchanged, so `RequestRegistry` and the review
  tools (`request_review` etc.) work over Jazz with **zero changes**.
- Don't flip the default to `jazz` until the Step 9 local acceptance test passes.

> ⚠️ API churn: `jazz-tools` is alpha. `startLocalJazzServer` is a dev helper —
> wrap it (Step 3) so an API change touches one file. Pin the `jazz-tools` version.
