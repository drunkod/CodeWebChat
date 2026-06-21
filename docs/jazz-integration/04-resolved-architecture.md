# Jazz integration — resolved architecture (after the Jazz dev's answers)

This supersedes the open questions in `01`–`03`. Answers are grounded in the
`garden-co/jazz` source (DeepWiki Q&A). The three pivotal unknowns are now
resolved, and one was a hard correction.

## The three answers that reshaped the plan

### 1. ⛔ The Jazz client does NOT run in an MV3 service worker (persistent mode)
Jazz **persistent** browser mode now requires **SharedWorker + MessageChannel +
Web Locks**, and OPFS requires a **dedicated `WorkerGlobalScope`**. An MV3 service
worker has **none** of these — `createDb()` throws on startup
(`browser-broker-protocol.ts` capability check; `opfs-btree/file.rs` worker
check).

✅ **Resolution: the extension uses `driver: { type: "memory" }` + `serverUrl`.**
Memory mode skips OPFS and the worker entirely; the SW global syncs **directly**
with the localhost sync server over WebSocket. When the SW is killed and
restarted, it reconnects and **subscriptions replay automatically** from the
server. The **Node backend is the durable store**, not the extension.

> Do NOT use `createExtensionJazzClient()` — that export is for the Jazz DevTools
> extension (inspecting a page's client), not for building your own.

### 2. There is no "Group" in Jazz 2.0 — sharing is the `appId` + row-level permissions
The Group/CoValue model was Jazz **1.x**. In 2.0, two peers share data simply by
**connecting to the same sync server with the same `appId`** (the `appId` is the
namespace). Access is **row-level via `permissions.ts`**. For a **private local
channel**, set the request/response tables to `allowRead.always()` /
`allowInsert.always()` / `allowUpdate.always()`.

Identity = a **32-byte secret** → deterministic user ID (no server registry). For
the extension, generate a fixed secret once, store it in `chrome.storage.local`,
pass it as `secret` to `createDb`. The Node side uses `createJazzContext(...)` +
`context.asBackend()` (authored as `jazz:system`).

### 3. "Local" = a localhost sync server, spawned from Node — no P2P mode
There is **no direct peer-to-peer** mode. Both processes connect to a localhost
sync server. ✅ **Spawn it programmatically from the MCP server** via
`startLocalJazzServer()` (from `jazz-tools/dev`, wrapping the `DevServer` NAPI
class) — the same embedded pattern the Vite/Next plugins use. So "start the MCP
server" can bring up local sync as a child, exactly like host mode self-contains
the relay today.

## The corrected architecture

```
Node MCP server (apps/mcp-server)
  ├─ startLocalJazzServer({ appId, port, dataDir })      // spawn local sync (child)
  ├─ createJazzContext({ driver:{type:'persistent'}, serverUrl:'ws://localhost:PORT', ... })
  └─ context.asBackend()  →  insert chat_requests · subscribe chat_responses   ← DURABLE STORE

         ▲  ws://localhost:PORT (WebSocket sync, no internet)
         ▼

Chrome extension background SW (apps/browser)
  └─ createDb({ driver:{type:'memory'}, serverUrl:'ws://localhost:PORT', secret })  // MEMORY MODE
       subscribe chat_requests(status='pending')  →  drive chatbot  →  insert chat_responses
```

No port 55155, no `gemini-coder` token, **no OS clipboard** (reply rides in
`chat_responses.response_text`).

## Confirmed design decisions

| Topic | Decision (from the source) |
| --- | --- |
| Extension storage | `driver: { type: 'memory' }` (persistent impossible in MV3 SW) |
| Durable store | the **Node backend** (`driver: 'persistent'`); extension holds nothing |
| Sharing model | same `appId`; **row-level permissions** (`allow*.always()` for the private channel) — no Group |
| Identity | 32-byte `secret` per peer; extension secret persisted in `chrome.storage.local` |
| Local server | `startLocalJazzServer()` from `jazz-tools/dev`, spawned by the MCP server |
| RPC shape | insert-row + subscribe-for-reply (no first-class Inbox in 2.0); **two tables** |
| Claiming | no atomic claim — LWW on a `status` column; fine for a single extension; make handlers idempotent |
| Cleanup | `db.delete()` is a **soft delete** (drops from live queries, stays in history); soft-delete consumed rows |
| Subscription cost | scales with the **matched set**, not table size (incremental deltas) |
| Latency | local tier sub-ms; localhost edge ~<5ms. Request: Node insert `wait({tier:'local'})`. Response: extension insert `wait({tier:'edge'})` |
| Node subscription | long-lived `subscribeAll` is fine (native `NapiRuntime`, no worker lifecycle) |
| Offline | extension asleep → gets requests on wake via subscription replay; LWW per column |
| SW lifecycle | memory mode + serverUrl survives SW kill/restart (reconnect + replay) |

## ⚠️ Security caveat (echoes our own host-mode bug)
The sync server **binds `0.0.0.0`** (all interfaces) — there is **no `--bind`
flag** to restrict to loopback (`server.rs`: `SocketAddr::from(([0,0,0,0],port))`),
and in dev, **local-first auth accepts any self-signed token**. So any local (or
LAN) process that knows the `appId` + port can read/write the channel — the same
class of issue we just hit in `HostTransport`. Mitigations the dev listed:
- use a **non-guessable `appId`** (UUID), not a friendly name;
- run with `NODE_ENV=production` + external JWT so random local processes can't auth;
- **firewall the port** at the OS level.
Worth raising with the dev whether a loopback-bind option can be added.

## API stability (build-on-able now)
| API | Stability |
| --- | --- |
| `createJazzContext`, `asBackend()`, `forRequest()` | stable-ish (core backend) |
| `createDb`, `insert/update/delete/subscribeAll`, `wait({tier})` | stable-ish (core client) |
| `driver:'memory'` + `serverUrl` | stable pattern |
| `runtimeSources` | stable interface |
| `jazz-tools server` CLI flags | alpha — may change |
| `startLocalJazzServer()` (`jazz-tools/dev`) | less stable (dev helper) — wrap it |
| SharedWorker broker | very new |

## Corrected build order

1. **Schema + permissions** (`packages/shared`): `chat_requests` / `chat_responses`
   tables; `allow*.always()` for the private local channel.
2. **MCP-server side (lower risk, do first):**
   a. Wrap `startLocalJazzServer()` so the server spawns local sync.
   b. `JazzTransport` implementing the `CwcTransport` contract: `sendInitializeChat`
      = `db.insert(chat_requests, …)`; the reply = a `chat_responses` subscription.
      `RequestRegistry` / review tools stay unchanged.
   c. Behind `--transport jazz|ws` (default `ws`); keep `HostTransport` as fallback.
3. **Extension side:** `createDb({ driver:'memory', serverUrl, secret })` in the
   background SW; subscribe `chat_requests`, drive the chatbot, insert
   `chat_responses` with the reply text (replacing the clipboard copy). Feature-flag
   it against the current WS client.
4. **Local acceptance test** (`02-…` §L4) but with memory-mode extension; then flip
   the default to `jazz` once green.
5. Remote later: `serverUrl` → cloud + JWT (Q18/Q19 confirmed: just config).

## What this does for the rest of the project
- **Kills the clipboard** (the reply is a row) — supersedes the old "Phase C."
- **Removes the WS relay / port 55155** as the primary path (kept as fallback).
- Same code for **local and remote** — only `serverUrl` + auth change.
- The fragile MV3/OPFS path is avoided entirely by the memory-mode decision.
