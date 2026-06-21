> ✅ **ANSWERED** (DeepWiki Q&A against `garden-co/jazz` source). The resolved
> design is in **`04-resolved-architecture.md`**. Headlines: extension uses
> `driver:'memory'`+`serverUrl` (persistent mode is impossible in an MV3 SW);
> no "Group" in 2.0 (same `appId` + row-level permissions); spawn the local sync
> server via `startLocalJazzServer()`; the server binds `0.0.0.0` (security
> caveat). Keep this file as the question record; build from `04`.

# Questions for the Jazz developer

Context to give him first: I want two separate processes — a **Node MCP server**
and a **Chrome MV3 extension (background service worker)** — to exchange
request/response messages **using Jazz as the channel**, replacing a custom
`localhost:55155` WebSocket + OS-clipboard hack. The plan is a shared
`chat_requests` / `chat_responses` table: the server inserts a request row, the
extension subscribes and writes a response row, the server subscribes for it.
**Local-first is the priority** (prefer no internet); remote (Jazz Cloud /
self-hosted edge) is a later switch.

Questions are ordered by how much the answer changes my design.

---

## A. Is this the right way to use Jazz at all?

1. **Is "Jazz as a request/response transport" a supported pattern, or an
   anti-pattern?** My research suggested using Jazz for *durable state* and a
   separate channel for RPC. But I want one mechanism. Is modeling RPC as
   insert-a-row + subscribe-for-the-reply something you'd endorse, or is there a
   **first-class primitive** (you mentioned Inbox / server-worker patterns) that's
   the intended way to do client↔server messaging on top of sync?
2. If rows are fine, do you recommend **two tables (requests/responses)** or **one
   table with a direction/status column**? Any gotchas with correlating by a
   `request_id` text column vs. a relation?
3. What's the **idiomatic way to consume a one-shot request** — subscribe to
   `where({ status: 'pending' })` and flip status to claim it? Is there a safe
   **claim/lease** pattern so the extension doesn't double-process a row (and so a
   second client wouldn't)?

## B. The Chrome MV3 extension client (my biggest risk)

4. **Does the Jazz browser client run inside an MV3 *service worker*?** It uses
   OPFS + a dedicated worker + WebAssembly. MV3 SWs are event-driven and
   restricted. Specifically:
   - Is **OPFS** available/reliable in an extension service worker?
   - Do the **dedicated worker** and **WASM** load there (with
     `script-src 'self' 'wasm-unsafe-eval'`)?
   - Does the SW being **killed/restarted** corrupt or just resume the client?
5. If the SW is a bad host, what do you recommend — an **offscreen document**, a
   persistent extension page, or `driver: { type: 'memory' }` + `serverUrl` (skip
   OPFS, rely on the sync server)? Which keeps a **live subscription** alive most
   reliably under MV3 lifecycle rules?
6. For bundling into an extension (no standard framework dev-plugin), what
   `runtimeSources` overrides do I need (`wasmUrl` / `workerUrl` / `baseUrl`), and
   do you have a **Chrome-extension example** (like the Cloudflare worker one)?
7. Any known issues with **`navigator.storage.persist()`** / OPFS eviction inside
   an extension specifically?

## C. Local-first, headless peering & identity (no interactive login)

8. Two **headless** peers (a Node daemon + an extension background worker, no human
   login at start) need to **share the same `chat_requests`/`chat_responses` rows**.
   What's the simplest way to put them in the **same Group** with read/write for
   both? Does the backend create a Group and add the extension's account, and how
   do they **agree on that Group id / account** at first run (pre-shared secret,
   backend-minted invite, a well-known appId)?
9. With **local-first auth**, each peer has its own device `secret` = its own
   identity. How do I get a **stable shared identity or shared Group** across the
   two processes without a cloud account — is there a recommended bootstrap (e.g.
   the server generates and hands the extension a secret/invite)?
10. Can two processes sync **purely locally with no internet** *only* via a
    localhost sync server, or is there a **direct peer-to-peer / shared-storage**
    mode (no server) you'd recommend for same-machine comms? (I'd love "no server
    at all" if it exists, but I assume the localhost sync server is the answer.)

## D. Running the sync server

11. Is the `jazz-tools@alpha server` **production-usable**, or strictly dev? For a
    desktop app where the user runs locally, can I **spawn it as a child process of
    my Node MCP server** so "start the MCP server" also starts local sync — or
    should it be a separate long-running service?
12. For a **Node** backend (no Vite/Next plugin), how do I **push `schema.ts` /
    `permissions.ts`** to the local server — `jazz-tools deploy <appId>`, or does
    structural auto-sync cover dev? What's the prod migration story
    (`jazz-tools deploy`)?
13. **Local security:** the sync server listens on a port with an `appId`. On a
    shared machine, could another local process connect with the same `appId` and
    read/write our rows? Is there a **local bind / token / admin-secret** I should
    set so the localhost channel isn't world-open? (We just hit an analogous
    "binds all interfaces + static token" issue in our own server, so I care about
    this.)

## E. Performance & lifecycle (interactive feel)

14. For an **interactive** request→reply on the **Local tier** over a localhost
    server, what round-trip latency should I expect? Is `db.insert(...).wait({ tier
    })` the right way to know "the other peer can see it," and which **tier** do you
    recommend for (a) request delivery and (b) the response?
15. The Node MCP server holds a **long-lived subscription** while also serving MCP
    over stdio. Any problem keeping a persistent `subscribeAll` open for the
    process lifetime? Backpressure/memory concerns as rows accumulate?
16. **Row lifecycle:** request/response rows will pile up. What's the recommended
    **cleanup/TTL** pattern — delete after consumption, a sweeper, or do you keep
    history deliberately (row versions) and filter by time? Does subscription cost
    grow with table size or only with the matched set?
17. **Offline/replay:** if the extension is asleep when the server inserts a
    request, does it get it on wake via subscription replay? Any **ordering**
    guarantees I can rely on, given last-writer-wins?

## F. Remote & auth (later)

18. Moving to **Jazz Cloud / remote edge** — is it truly just `serverUrl` + JWT, or
    are there extension-specific gotchas (CORS, WebSocket vs HTTP, MV3 host
    permissions for `v2.sync.jazz.tools`)?
19. For production multi-user, you recommend **external JWT**. What's the minimal
    JWKS/issuer setup, and can I keep **local-first for the local mode** and **JWT
    for remote** in the same codebase, switching by config?
20. `asBackend()` writes are authored as `jazz:system`. For an **audit trail** of
    who triggered a review, should I use `withAttribution(...)` / `forRequest()` —
    and does that matter at all in the local single-user case?

## G. Stability / process

21. It's **alpha** — which APIs are **stable enough to build on** now, and which
    are likely to churn? Anything in my plan (`createDb`, `createJazzContext`,
    `subscribeAll`, the server CLI, `runtimeSources`) you'd flag as moving?
22. If you were integrating Jazz into a **Chrome-extension + Node** pair for
    local-first request/response, **what would you do differently** from the plan
    above? What's the one thing people get wrong first?

---

## The three answers that most change the plan

- **Q4/Q5 (MV3 client host)** — decides whether the extension can run Jazz in the
  service worker at all, or needs an offscreen document. Biggest unknown.
- **Q8/Q9 (headless shared Group)** — decides how the two peers find each other and
  share rows without a login.
- **Q10/Q11 (local server)** — decides whether "local" means a child-process sync
  server (likely) and whether that's production-safe.

Capture his answers inline; then we fold them into `01`/`02` and turn the local
acceptance test (`02-...` §L4) into a concrete build plan.
