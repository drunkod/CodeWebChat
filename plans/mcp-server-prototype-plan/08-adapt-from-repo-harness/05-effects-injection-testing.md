# Step 5 — Effects injection & testing strategy (V0)

> ⚠️ **Attribution correction (from the developer's review):** this is a
> *general* testability pattern, **not** something you are copying from
> repo-harness. repo-harness calls its effects (`runHelper`, `runProcess`)
> **directly** inside `tools.ts` — they are not injected. Adopt the injection
> idea on its own merits for your WebSocket + clock + clipboard; just don't
> frame it as "porting repo-harness." The **test layering** below (mock at the
> transport boundary, not inside the SDK) *is* drawn from how they test.

**Source:** direct effect calls in `draft/src/cli/mcp/tools.ts` (`runProcess`,
`runHelper`) — shown as the contrast, not the model; test approach from the Q&A.

## Developer's answer (how they test)

> "Five test files: `mcp-policy.test.ts` (path/glob/traversal/symlink),
> `mcp-tools.test.ts` (allowed/denied reads, write, validation, overwrite,
> redaction, audit hashing), `mcp-setup.test.ts`, `mcp-http.test.ts` (real
> express server, full OAuth flow), `mcp.test.ts` (CLI smoke)."
>
> "The SDK transport is **not mocked** for HTTP — it uses a real express server
> on a test port. **Mock at the transport boundary, not inside the SDK.** Test
> the tool logic directly (unit) and the transport separately (integration)."

## The pattern

Side effects are passed in, not called inline, so tests substitute fakes. Your
Step 3 already does this with `read_clipboard`:

```ts
const bridge = new CwcBridge({ read_clipboard: readSystemClipboard })
```

Extend it so **every** effect is injectable: the WebSocket factory, the clock,
and the clipboard.

## Adapt to `cwc-mcp-server`

```ts
// apps/mcp-server/src/cwc-bridge.ts
export interface BridgeDeps {
  read_clipboard: () => Promise<string>
  connect: (url: string, token: string) => WebSocketLike   // injectable WS factory
  now: () => number                                          // injectable clock
  sleep: (ms: number) => Promise<void>
}

export class CwcBridge {
  constructor(private deps: BridgeDeps) {}
  // ...uses this.deps.* everywhere, never imports ws/clipboard directly
}
```

Then your Step 5 tests run with **no real WebSocket and no real clipboard**:

```ts
import { test, expect } from 'bun:test'

test('APPLY_TIMEOUT when clipboard never changes', async () => {
  let t = 0
  const bridge = new CwcBridge({
    read_clipboard: async () => 'OLD',          // never changes
    connect: () => fakeSocket(),                // canned messages
    now: () => (t += 1000),                     // controllable clock
    sleep: async () => {},                      // no real waiting
  })
  const res = await sendToCodeWebChat(bridge, { prompt: 'hi', timeout_ms: 5000 })
  expect(JSON.parse(res.content[0].text).error.code).toBe('APPLY_TIMEOUT')
})
```

### Test layering to mirror repo-harness

| Layer | What you test | How |
| --- | --- | --- |
| Unit | `redact()`, error codes, timeout/poll logic | pure functions + injected fakes |
| Integration | tool ↔ bridge ↔ fake WebSocket | in-process, no SDK |
| Smoke | real stdio transport lists your 2 tools | official `StdioClientTransport` |

The developer's stdio smoke used the official `StdioClientTransport` to connect
and assert the tool list — cheap and catches wiring breakage. Add one.

## Checklist

- [ ] WebSocket factory, clock, clipboard all injected via constructor.
- [ ] Unit tests assert on error codes from step 2.
- [ ] Integration test uses a fake socket emitting canned CWC messages.
- [ ] One stdio smoke test using the real `StdioClientTransport`.
