# Step 6b — Phase C: add an inline reply option (clipboard retained)

> ⚠️ **DECISION: do NOT delete clipboard support.** This step is now _additive_:
> it adds an inline `response_text` reply path. The OS clipboard remains a
> first-class, supported capture/return path. The registry **prefers** inline
> `response_text` when present and **falls back to the clipboard**
> (`use_clipboard_fallback`, default `true`). Ignore any wording below that says
> "kill/remove/delete the clipboard" — treat those as "inline becomes available,"
> not removal.

Companion to `06-step-upgrade-protocol-for-v1.md`. Complete, copy-ready code for
adding `request_id` + `response_text` to the protocol so the reply _can_ be carried
inline. These are **plan code examples** (diffs to apply when you build the inline
path), not edits to any repo resource.

## The key insight (why this change is small)

The browser extension **already copies the response to the OS clipboard** when the
user clicks _Apply Response_ — each chatbot integration provides a `perform_copy`
that clicks the site's native copy button
(`apps/browser/.../utils/add-apply-response-button.ts:43`).

So instead of the **MCP server** racing the OS clipboard (fragile: timing,
permissions, the `CWC_CLIPBOARD_UNCHANGED` guard), the **browser** reads its own
clipboard _inside the same click gesture_ and sends the text over the WebSocket.
The MCP server then never touches the clipboard at all.

```
BEFORE (V0):  click Apply → perform_copy → [OS clipboard] ← MCP server reads (race)
AFTER  (V1):  click Apply → perform_copy → browser reads clipboard → response_text in apply-chat-response → MCP server uses it directly
```

This reuses every existing per-chatbot `perform_copy` unchanged — no 20×
per-chatbot DOM scrapers needed for the minimal version (see Option B at the end
for the more robust long-term path).

---

## Part 1 — Shared protocol (both repos agree on the wire)

### MCP server `src/protocol.ts` (mirror of `@shared` types)

```ts
export type InitializeChatMessage = {
  action: 'initialize-chat'
  text: string
  url: string
  client_id: number
  request_id?: string // NEW: correlate one prompt ↔ one response
  // ...all existing optional fields unchanged
}

export type ApplyChatResponseMessage = {
  action: 'apply-chat-response'
  client_id: number
  request_id?: string // NEW: echoed back by the browser
  response_text?: string // NEW: the chatbot reply, sent inline
  raw_instructions?: string
  edit_format?: string
  url?: string
}
```

Both fields are **optional** → fully backward compatible with the real VS Code
extension and any older browser build that doesn't send them.

---

## Part 2 — MCP server: prefer `response_text`, fall back to clipboard

Only `PromptRunner` changes. Transports (`ClientTransport` / `HostTransport`)
are untouched — they already just ferry messages.

### `src/prompt-runner.ts` (diff from Step 2c)

```ts
import { randomUUID } from 'node:crypto'
// ...

export class PromptRunner {
  // pending now also tracks request_id
  private pending: {
    request_id: string
    client_id: number
    resolve: (m: ApplyChatResponseMessage) => void
    reject: (e: CwcMcpError) => void
  } | null = null

  constructor(
    private readonly transport: CwcTransport,
    private readonly read_clipboard: ReadClipboard,
    private readonly clipboard_read_delay_ms = 250
  ) {
    this.transport.onApplyResponse((message) => {
      if (!this.pending) return
      // Prefer request_id match; fall back to client_id for older browsers.
      const matches = message.request_id
        ? message.request_id === this.pending.request_id
        : message.client_id === this.pending.client_id
      if (matches) this.pending.resolve(message)
    })
    this.transport.onClose((error) => {
      this.pending?.reject(error)
      this.pending = null
    })
  }

  private async run(input: SendPromptInput): Promise<string> {
    const { client_id } = await this.transport.ensureReady(
      input.connect_timeout_ms ?? 3000
    )
    const request_id = randomUUID()

    // Only read the "before" clipboard if we might need the fallback.
    const before_clipboard = await this.read_clipboard().catch(() => '')

    const timeout_ms = input.timeout_ms ?? 300_000
    const apply_promise = this.waitForApply(request_id, client_id, timeout_ms)

    this.transport.sendInitializeChat({
      action: 'initialize-chat',
      client_id,
      request_id, // NEW
      text: input.text,
      url: input.url
      // ...rest of the fields unchanged
    })

    const apply = await apply_promise

    // V1 path: response text arrived inline — no clipboard, no guard, done.
    if (typeof apply.response_text === 'string' && apply.response_text.trim()) {
      return apply.response_text
    }

    // V0 fallback: older browser that didn't send response_text.
    await sleep(this.clipboard_read_delay_ms)
    const after_clipboard = await this.read_clipboard()
    if (!after_clipboard.trim()) {
      throw new CwcMcpError(
        'Apply Response completed, but the clipboard was empty.',
        'CWC_CLIPBOARD_EMPTY'
      )
    }
    if (after_clipboard === before_clipboard) {
      throw new CwcMcpError(
        'Apply Response completed, but the clipboard did not change. Refusing to return stale clipboard content.',
        'CWC_CLIPBOARD_UNCHANGED'
      )
    }
    return after_clipboard
  }

  private waitForApply(
    request_id: string,
    client_id: number,
    timeout_ms: number
  ) {
    return new Promise<ApplyChatResponseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null
        reject(
          new CwcMcpError(
            `Timed out after ${timeout_ms}ms waiting for Apply Response. The user must click Apply Response in the chatbot tab.`,
            'CWC_TIMEOUT'
          )
        )
      }, timeout_ms)
      this.pending = {
        request_id,
        client_id,
        resolve: (m) => {
          clearTimeout(timer)
          this.pending = null
          resolve(m)
        },
        reject: (e) => {
          clearTimeout(timer)
          this.pending = null
          reject(e)
        }
      }
    })
  }
}
```

Net effect: once the browser sends `response_text`, the registry prefers it and the
clipboard block becomes the fallback path. **Decision: keep the clipboard block,
`read_clipboard`, the `clipboardy` dependency, and the clipboard error codes** —
they remain the supported fallback when no inline `response_text` is present. Do NOT
delete them.

---

## Part 3 — The browser change (the "small change")

Four edits, all threading two new fields through paths that already carry
`client_id` and `raw_instructions`.

### 3a. `apps/browser/src/types/messages.ts`

```ts
type ApplyChatResponseMessage = {
  action: 'apply-chat-response'
  client_id: number
  request_id?: string // NEW
  response_text?: string // NEW
  raw_instructions?: string
  edit_format?: string
  url?: string
}
```

### 3b. Thread `request_id` through storage → observer → button

`request_id` arrives on the `initialize-chat` message. It must reach the apply
button the same way `client_id` does today:

- In `background/message-handler.ts` `handle_initialize_chat_message`, include
  `request_id` when writing `chat-init:${batch_id}` to `browser.storage.local`.
- In `send-prompt-content-script.ts`, read `request_id` from `stored_data`, add it
  to both the `sessionStorage` `session_data` blob and the
  `chatbot.setup_observer({ ... })` params.
- Each chatbot's `setup_observer` already forwards its params into
  `add_apply_response_button({ ... })` (e.g. `chatbots/meta.ts:49`) — add
  `request_id: params.request_id` there. (Mechanical, one line per chatbot; or
  change the shared observer param type so it flows automatically.)

### 3c. `apps/browser/.../utils/add-apply-response-button.ts` — capture text + ids

The only behavioral change. After the existing `perform_copy`, read the clipboard
the extension just wrote, and include `request_id` + `response_text`:

```ts
export function add_apply_response_button(params: {
  client_id: number
  request_id?: string // NEW
  raw_instructions?: string
  edit_format?: string
  footer: Element
  get_chat_turn: (footer: Element) => HTMLElement | null
  perform_copy: (footer: Element) => void | Promise<void>
  insert_button: (footer: Element, button: HTMLButtonElement) => void
  customize_button?: (button: HTMLButtonElement) => void
}) {
  // ...unchanged button setup...

  apply_response_button.addEventListener('click', async () => {
    set_button_disabled_state(apply_response_button)
    requestAnimationFrame(async () => {
      await params.perform_copy(params.footer) // existing: writes clipboard
      await new Promise((resolve) => setTimeout(resolve, 500))

      // NEW: read back what perform_copy just copied (allowed within this click gesture)
      let response_text: string | undefined
      try {
        response_text = await navigator.clipboard.readText()
      } catch {
        response_text = undefined // fall back to MCP-side clipboard read
      }

      browser.runtime.sendMessage<Message>({
        action: 'apply-chat-response',
        client_id: params.client_id,
        request_id: params.request_id, // NEW
        response_text, // NEW
        raw_instructions: params.raw_instructions,
        edit_format: params.edit_format,
        url: window.location.href
      })
    })
  })

  // ...unchanged insert...
}
```

> Why this is safe: `navigator.clipboard.readText()` requires a user gesture and
> clipboard-read permission. You're inside the Apply click (gesture ✓) and
> `perform_copy` just wrote the value (so it's the response, not stale data). If
> the read is blocked, `response_text` is `undefined` and the MCP server silently
> uses its V0 clipboard fallback — nothing breaks.

### 3d. `apps/browser/src/background/message-handler.ts` — forward the fields

```ts
} else if (message.action == 'apply-chat-response') {
  send_message_to_server({
    action: 'apply-chat-response',
    client_id: message.client_id,
    request_id: message.request_id,        // NEW
    response_text: message.response_text,  // NEW
    raw_instructions: message.raw_instructions,
    edit_format: message.edit_format,
    url: message.url
  } as ApplyChatResponseMessage)
}
```

And `packages/shared/src/types/websocket-message.ts` `ApplyChatResponseMessage`
gains the same two optional fields (Step 6 already adds them to
`InitializeChatMessage`; do the same here).

---

## Part 4 — Backward compatibility (nothing forced to upgrade)

| Sender → Receiver                    | Behavior                                                         |
| ------------------------------------ | ---------------------------------------------------------------- |
| New browser → New MCP server         | `response_text` used; clipboard never touched. ✅ goal           |
| Old browser → New MCP server         | no `response_text` → MCP falls back to its V0 clipboard read. ✅ |
| New browser → real VS Code extension | extra optional fields ignored; existing flow intact. ✅          |

So you can ship the browser change and the server change independently.

---

## Part 5 — Tests

### MCP server: inline response, clipboard NOT read

```ts
test('Phase C: response_text is used directly, clipboard untouched', async () => {
  let clipboard_reads = 0
  const read_clipboard = async () => {
    clipboard_reads++
    return 'should-not-matter'
  }
  const transport = new FakeTransport() // emits apply with response_text
  const runner = new PromptRunner(transport, read_clipboard)

  transport.onNextInitialize((msg) => {
    transport.emitApply({
      action: 'apply-chat-response',
      client_id: msg.client_id,
      request_id: msg.request_id,
      response_text: 'INLINE REPLY'
    })
  })

  const text = await runner.send({ url: 'https://claude.ai/new', text: 'hi' })
  assert.equal(text, 'INLINE REPLY')
  assert.equal(clipboard_reads, 1) // only the optional "before" read; never the "after"
})
```

### MCP server: back-compat fallback when `response_text` absent

```ts
test('Phase C: no response_text -> clipboard fallback (V0 path)', async () => {
  const seq = ['OLD', 'NEW FROM CLIPBOARD']
  let i = 0
  const read_clipboard = async () => seq[Math.min(i++, seq.length - 1)]
  const transport = new FakeTransport()
  const runner = new PromptRunner(transport, read_clipboard)

  transport.onNextInitialize((msg) => {
    transport.emitApply({
      action: 'apply-chat-response',
      client_id: msg.client_id,
      request_id: msg.request_id
    })
  })

  const text = await runner.send({ url: 'https://claude.ai/new', text: 'hi' })
  assert.equal(text, 'NEW FROM CLIPBOARD')
})
```

(For host mode, the "fake browser" from `02c` simply adds `response_text` to the
`apply-chat-response` it sends — same assertion.)

---

## Option B — robust long-term: per-chatbot `get_response_text`

The clipboard-readback above is the **minimal** change and works for every
chatbot that already has a `perform_copy`. The more robust path (ADR-007) is a
per-chatbot `get_response_text(footer)` that extracts the reply straight from the
DOM, avoiding the clipboard entirely even inside the browser:

```ts
// in each chatbot's setup_observer params, optionally:
get_response_text: (footer: Element) => string | undefined
// e.g. read the assistant turn's rendered markdown container's innerText
```

Then `add_apply_response_button` prefers `get_response_text(footer)` and falls
back to the clipboard readback. Roll out incrementally — Claude, ChatGPT, Gemini
first (they're the highest-traffic), the rest later — exactly as ADR-007 plans.
Start with Option A to get the win cheaply; add Option B per chatbot where DOM
extraction proves more reliable.

---

## Build order recap (Phase C)

```text
[ ] Add request_id + response_text (optional) to @shared + MCP protocol types.
[ ] PromptRunner: generate request_id, match on it, prefer response_text, keep clipboard fallback.
[ ] Browser: thread request_id (storage -> observer -> button); read clipboard in the click; forward both fields in background.
[ ] Tests: inline-response path + clipboard fallback path (both supported).
[ ] Demo: prompt -> Apply -> tool returns text via inline response_text (optional capability check).
[ ] KEEP the clipboard read, clipboardy dep, and clipboard error codes — clipboard
    remains a supported path. (Do NOT delete them.)
```

**Definition of done:** put unrelated junk on your OS clipboard, run a prompt,
click Apply — the tool returns the chatbot reply, not the junk. That proves the
clipboard is out of the path.
