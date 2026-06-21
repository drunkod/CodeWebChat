# Jazz v2 integration — overview

Goal: let the **MCP server (Node)** and the **Chrome extension** communicate
**using Jazz** instead of the current `localhost:55155` WebSocket bridge + OS
clipboard. **Local-first** is the priority; remote (Jazz Cloud / self-hosted edge)
is the same code with a different `serverUrl`.

Grounded in the Jazz docs (`reference/mcp` docs server) and your research report
`deep-research-report (1).md`.

## What Jazz v2 actually is (and why it fits)

Jazz v2 is **"the database that syncs"** — a local-first relational store where:

- you define **tables** in a `schema.ts` DSL,
- every client keeps a **local replica** and reads are instant,
- you **subscribe to a query** (`db.subscribeAll(app.x.where({...}), cb)`) and get
  pushed updates whenever matching rows change,
- writes (`db.insert/update/delete`) are local-first and sync upward through
  **tiers: Local → Edge (sync server) → Global**.

So two processes "communicate" by **writing rows to a shared table and
subscribing to it** — there is no bespoke socket protocol and no clipboard.

## The core idea: rows replace the bridge AND the clipboard

Today:
```
MCP server ──WS initialize-chat──▶ [relay :55155] ──▶ extension ──drives chatbot──▶ Apply
                                                       extension copies reply to OS clipboard
MCP server ◀──WS apply-chat-response (signal only)── extension ; MCP reads clipboard
```

With Jazz:
```
MCP server ──db.insert(chat_requests,{request_id,url,text})──▶ [Jazz sync server] ──sync──▶ extension
   extension subscribes chat_requests(status='pending') → drives chatbot → gets reply text
MCP server ◀── subscribes chat_responses(request_id) ◀── extension db.insert(chat_responses,{request_id, response_text})
```

The reply text travels **inside a Jazz row** (`response_text`), so the OS
clipboard disappears from the design entirely — this is the clean version of
"Phase C" (drop the clipboard), achieved by changing the transport, not by
scraping the clipboard faster.

## Local-first, then remote — what "local" means here

Two separate OS processes (the Node MCP server and the browser extension) do
**not** share a local replica — each has its own. To sync between them they both
connect to a **sync server**. So:

- **Local communication = a Jazz sync server running on `localhost`.** You self-host
  it with one command (`npx jazz-tools@alpha server <appId> --port 1625`); both
  peers point `serverUrl` at it. Writes settle at the **Local** tier instantly and
  sync peer-to-peer through that local edge — no cloud, no internet. In dev,
  **local-first auth is on by default**, so no auth server is needed.
- **Remote = the same schema/code** with `serverUrl = https://v2.sync.jazz.tools/`
  (Jazz Cloud) or your own remote edge, plus external JWT auth.

"Prefer local if possible" → default to the localhost sync server; treat remote as
an opt-in for cross-machine/cross-network use. The only differences are
`serverUrl` and the auth mode.

## How this maps onto our existing work

- The **host-mode MCP server** (Phases 0/A/B) is the natural home for the Jazz
  **backend context** — it already runs long-lived and owns the "editor side."
- The **browser extension** background worker is the Jazz **client** — it already
  owns orchestration (open tab, drive chatbot) and is the right place per MV3
  (network/state work in the service worker, DOM automation in content scripts).
- The current WebSocket relay (`apps/editor` server + the `cwc-mcp-server` host
  transport) becomes a **fallback adapter**, not the primary path.

## The honest tradeoff (from the research report)

Your research report recommends Jazz for **durable state/intent** (preferences,
hosts, audit rows) and keeping a *separate* transport for raw RPC, because
modeling every request as a synced row adds sync latency vs. a direct socket. You
asked for "**all of this using Jazz**" — i.e. Jazz *as* the channel — which is a
deliberate, valid choice: it buys one mechanism, offline tolerance, row history
(audit), permissions, and identical local/remote code, at the cost of tuning
durability tiers so an interactive request feels instant. For a local sync server
the Local tier is effectively instant, so this is a good fit; the latency caveat
matters more for the remote/cloud path. This is the single biggest thing to
confirm with the Jazz developer (see `03-questions-for-jazz-developer.md`).

## Documents in this folder

- `01-architecture-and-schema.md` — the shared schema, both peers' setup code,
  the request/response flow, and the MV3 risks.
- `02-local-then-remote.md` — run the local sync server, the local config, then
  the remote switch; migration & rollback (keep the WS bridge as fallback).
- `03-questions-for-jazz-developer.md` — detailed questions for your friend.
