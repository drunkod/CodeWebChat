# Step 8 — Capture the reply, bundle WASM, manifest/CSP

Make `onRequest` actually drive the chatbot and return the reply **text**, and make
Jazz's WASM/worker load in the extension.

> **Clipboard is retained (decision).** The reply text may be obtained from the
> **clipboard readback** (the default, kept) and/or an **optional** DOM extractor
> (`get_latest_reply_text()`). DOM extraction is an _addition_, not a replacement —
> do NOT remove the clipboard path. Both end with the background worker holding the
> text; the registry prefers an inline `response_text` and falls back to clipboard.

## 8.1 Capture the reply as text

The existing CWC automation opens the chatbot tab and waits for the answer. Today,
on Apply, the content script copies the reply to the clipboard. Now we want the
**text** back in the background worker so it can write the Jazz row.

`apps/browser/src/background/capture.ts`:

```ts
import type { ChatRequestRow } from '@shared/jazz/messages'

export async function driveChatbotAndCaptureReply(
  req: ChatRequestRow
): Promise<string> {
  // 1. open/fill the chatbot (reuse existing message-handler logic)
  const tabId = await openChatbotTab(req.url, req.text, req.prompt_type)

  // 2. wait for the content script to report the reply text.
  //    Reuse the existing Apply flow, but instead of (or in addition to) copying
  //    to the clipboard, have the content script send the extracted text back:
  return await waitForReplyText(tabId, req.request_id)
}
```

Content-script change (in `add-apply-response-button.ts` / the per-chatbot
`perform_copy`): in addition to (or instead of) writing the clipboard, send the
captured text to the background:

```ts
// after capturing the reply text (the same text perform_copy puts on the clipboard):
chrome.runtime.sendMessage({
  action: 'cwc-reply-text',
  request_id, // threaded through like client_id is today
  response_text: replyText
})
```

Background `waitForReplyText` resolves the promise for that `request_id` when the
message arrives. (This is the Phase-C "read clipboard in the click" idea, but the
text goes to the background worker → Jazz row instead of the OS clipboard.)

> Minimal first version: keep the clipboard copy, and ALSO read it back in the
> background via `navigator.clipboard.readText()` inside the user gesture, then
> resolve `waitForReplyText`. Cleaner version: per-chatbot DOM extraction. Either
> way, the **background worker ends up with the text** and writes the Jazz row.

## 8.2 Bundle Jazz's WASM + worker as extension resources

Memory mode still needs the **WASM** (it skips OPFS/worker, but the runtime WASM
loads). MV3 forbids remote code, so ship the assets in the package and point
`runtimeSources` at `chrome-extension://` URLs.

1. Copy `jazz_wasm_bg.wasm` (and the worker entry if required) into the extension
   build output (e.g. `dist/jazz/`). Confirm exactly which assets memory mode needs
   — likely just the WASM.
2. Expose them via `web_accessible_resources` and reference with
   `chrome.runtime.getURL`:

```ts
const db = await createDb({
  appId,
  serverUrl,
  secret,
  driver: { type: 'memory' },
  runtimeSources: {
    wasmUrl: chrome.runtime.getURL('jazz/jazz_wasm_bg.wasm')
    // workerUrl: only if memory mode still needs it (confirm)
  }
})
```

## 8.3 `manifest.json` — CSP, host permission, resources

```jsonc
{
  "permissions": ["storage", "alarms"],
  "host_permissions": [
    "http://localhost:55155/",
    "ws://localhost:55155/", // legacy fallback
    "ws://localhost:1625/",
    "http://localhost:1625/" // Jazz local sync
    // add "wss://v2.sync.jazz.tools/*" for remote (Step 10)
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  },
  "web_accessible_resources": [
    { "resources": ["jazz/*"], "matches": ["<all_urls>"] }
  ]
}
```

- `wasm-unsafe-eval` is **required** for Jazz's WASM in MV3.
- Keep host permissions narrow (localhost ports only for local mode).

## 8.4 The two-build reality

Confirm CWC's extension bundler (likely esbuild/webpack/vite) can:

- emit the Jazz WASM asset into `dist/jazz/`,
- not try to inline remote code,
- resolve `jazz-tools` for a browser/SW target (it may need the same
  `runtimeSources` overrides the Cloudflare-worker example uses).

This is the most likely place to get stuck; budget time for the bundler config.

## Done when

- The background worker creates the Jazz memory client with WASM loaded from
  `chrome-extension://`.
- `driveChatbotAndCaptureReply` returns the chatbot reply **as a string**.
- Manifest grants `wasm-unsafe-eval`, the local Jazz port, and `jazz/*` resources.
