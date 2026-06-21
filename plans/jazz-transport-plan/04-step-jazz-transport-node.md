# Step 4 — `JazzTransport` (Node), implementing `CwcTransport`

The heart of the Node half. It implements the **same `CwcTransport` interface** as
`HostTransport`/`ClientTransport`, so `RequestRegistry` and the review tools work
unchanged. `sendInitializeChat` inserts a `chat_requests` row; replies arrive via a
`chat_responses` subscription and are surfaced through `onApplyResponse` — exactly
the shape the registry expects.

## 4.1 Key mapping

| `CwcTransport` member | Jazz implementation |
| --- | --- |
| `connect()` | init backend context + ensure subscription to `chat_responses` |
| `ensureReady()` | connect + confirm a browser/extension peer is alive (heartbeat row or presence) |
| `sendInitializeChat(msg)` | `db.insert(chat_requests, { request_id: msg.client_id??uuid, ... })` |
| reply path | subscription on `chat_responses` → call `apply_handler` with `{client_id, response_text}` |
| `onApplyResponse(h)` | store `h`; invoked when a matching response row appears |
| `onClose(h)` | store `h`; invoked if the Jazz client errors/disconnects |
| `status()` | `{ mode:'host', hosting:true, client_id, browser_connected, ... }` |
| `close()` | unsubscribe + shutdown the Jazz db |

> **Important contract detail:** `RequestRegistry` correlates the reply by
> `client_id` (it stamps `client_id` into `initialize-chat` and matches the
> apply's `client_id`). For Jazz we reuse `request_id` as that correlation key and
> echo it back as `client_id` in the synthesized apply message, so the registry's
> matching logic is untouched.

## 4.2 The transport

`apps/mcp-server/src/jazz-transport.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { createJazzContext } from 'jazz-tools/backend' // confirm path
import { app } from '@shared/jazz/schema.js'
import permissions from '@shared/jazz/permissions.js'
import type { ChatResponseRow } from '@shared/jazz/messages.js'
import { CwcMcpError } from './errors.js'
import type { BridgeStatus, CwcTransport } from './transport.js'
import type { InitializeChatMessage, ApplyChatResponseMessage } from './protocol.js'
import type { JazzConfig } from './jazz-config.js'

export class JazzTransport implements CwcTransport {
  public readonly mode = 'host' as const

  private db: any | null = null // Jazz Db handle (type from jazz-tools)
  private unsubscribe: (() => void) | null = null
  private connected = false
  private browser_seen_at = 0

  private apply_handler: (m: ApplyChatResponseMessage) => void = () => {}
  private close_handler: (e?: unknown) => void = () => {}

  // request_id -> client_id we told the registry (so we can echo it back on reply)
  private readonly inflight = new Map<string, number>()
  private client_id_counter = 0

  constructor(private readonly config: JazzConfig) {}

  onApplyResponse(h: (m: ApplyChatResponseMessage) => void): void { this.apply_handler = h }
  onClose(h: (e?: unknown) => void): void { this.close_handler = h }

  status(): BridgeStatus {
    return {
      mode: this.mode,
      hosting: this.connected,
      websocket_connected: this.connected,
      client_id: this.connected ? 1 : null,           // synthetic; host is the only editor
      browser_connected: Date.now() - this.browser_seen_at < 15_000,
      connected_browser_count: Date.now() - this.browser_seen_at < 15_000 ? 1 : 0
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return
    const context = createJazzContext({
      appId: this.config.appId,
      app,
      permissions,
      driver: { type: 'persistent', dataPath: '.jazz/mcp.db' },
      serverUrl: this.config.serverUrl,    // ws://localhost:PORT
      allowLocalFirstAuth: true,
      env: 'dev',
      userBranch: 'main'
    })
    this.db = context.asBackend()

    // subscribe to ALL responses; route each to the matching in-flight request
    this.unsubscribe = this.db.subscribeAll(
      app.chat_responses,
      ({ delta }: { delta: { item: ChatResponseRow }[] }) => {
        for (const change of delta) {
          const row = change.item
          if (!row?.request_id) continue
          const client_id = this.inflight.get(row.request_id)
          if (client_id === undefined) continue // not ours / already handled
          this.inflight.delete(row.request_id)
          // synthesize the apply message the registry expects
          this.apply_handler({
            action: 'apply-chat-response',
            client_id,
            // NOTE: registry currently reads the reply from the clipboard.
            // Step 5 swaps it to read response_text from this message (see 05 §5.3).
            url: undefined
          } as ApplyChatResponseMessage & { response_text?: string })
        }
      }
    )
    this.connected = true
  }

  async ensureReady(): Promise<void> {
    await this.connect()
    // optional: require a recent browser heartbeat row before allowing a send
    if (!this.status().browser_connected) {
      throw new CwcMcpError(
        'No CodeWebChat browser extension is connected to the Jazz channel.',
        'CWC_NO_BROWSER'
      )
    }
  }

  sendInitializeChat(message: InitializeChatMessage): void {
    if (!this.db) throw new CwcMcpError('Jazz transport not connected.', 'CWC_NOT_CONNECTED')
    const request_id = randomUUID()
    this.inflight.set(request_id, message.client_id)
    void this.db
      .insert(app.chat_requests, {
        request_id,
        url: message.url,
        text: message.text,
        prompt_type: message.prompt_type ?? 'edit-context',
        status: 'pending',
        created_at: Date.now()
      })
      // .wait({ tier: 'local' }) // confirms it's in the Node store; sync proceeds upward
      .catch((e: unknown) => {
        this.inflight.delete(request_id)
        this.close_handler(e)
      })
  }

  async close(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = null
    await this.db?.shutdown?.()
    this.db = null
    this.connected = false
  }

  // called by a presence/heartbeat subscription (optional, see 4.3)
  markBrowserSeen(): void { this.browser_seen_at = Date.now() }
}
```

## 4.3 Browser presence (optional but recommended)

`ensureReady()` should know a browser is actually listening (so a send doesn't
hang). Two options:

- **Heartbeat table:** the extension writes a `presence` row every ~5s; the Node
  side subscribes and calls `markBrowserSeen()`. (Add a `presence` table in
  Step 2 if you want this.)
- **Skip it for v0:** rely on `CWC_TIMEOUT` from the registry if no response
  arrives. Simpler; do this first, add presence later.

## 4.4 Why the registry/tools don't change

`RequestRegistry` only calls `transport.connect/ensureReady/sendInitializeChat/
onApplyResponse/onClose/status`. `JazzTransport` satisfies all of them, so
`send_to_codewebchat`, `request_review`, etc. work over Jazz with **no edits**.
The one wrinkle — getting the reply text out of the apply message instead of the
clipboard — is handled in Step 5.

## Done when

- `JazzTransport` compiles against the `CwcTransport` interface.
- `connect()` opens a backend context + a `chat_responses` subscription.
- `sendInitializeChat` inserts a request row and records the `request_id↔client_id`
  mapping.
- A response row for a known `request_id` triggers `apply_handler` with that
  `client_id`. (Exercised in Step 6 tests.)
