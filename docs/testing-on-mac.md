# Testing CodeWebChat on macOS

A step-by-step guide to verifying the MCP server and browser extension, on both
transports:

- **WebSocket + clipboard** — the default, always-works path.
- **Jazz** — the experimental local-first sync path.

All commands run from the repo root inside the nix dev shell. The helper scripts
in `scripts/` wrap `nix develop` for you; if you're already inside `nix develop`,
prefix any script with `CWC_NO_NIX=1`.

---

## 0. Prerequisites

- macOS (Apple Silicon or Intel). Jazz needs the native `jazz-napi` binary, which
  ships for macOS arm64/x64 — fine on a Mac.
- `nix` installed (the repo provides a dev shell).
- Google Chrome (or Chromium).

---

## 1. Build everything

```bash
scripts/build.sh
```

This runs `pnpm install` and builds both the MCP server and the browser
extension into `apps/browser/dist`.

---

## 2. Automated test suite

```bash
scripts/test.sh
```

Expected: **21 passed / 0 failed / 2 skipped**. The 2 skipped are the gated Jazz
integration tests (run them explicitly in steps 5–6).

---

## 3. Load the extension in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select `apps/browser/dist`.
4. Find the CodeWebChat extension card → click **service worker** (or **Inspect
   views**) to open its console. Keep that console open while testing.

---

## 4. Test the default path (WebSocket + clipboard)

This is the path you rely on; verify it first.

**4a. Disable Jazz** in the extension service-worker console:

```js
chrome.storage.local.set({ cwc_jazz_enabled: false })
```

**4b. Start the MCP server + drive it with the Inspector:**

```bash
scripts/inspect-ws.sh
```

Open the printed URL (≈ `http://localhost:6274`).

**4c. In the Inspector UI:**

1. Click **Connect** (transport is stdio).
2. **List Tools** → you should see `cwc_status`, `send_to_codewebchat`,
   `poll_cwc_response`, plus the review tools.
3. Call **`cwc_status`** → confirm `browser_connected: true` (the extension is
   connected to the relay on port 55155).
4. Call **`send_to_codewebchat`** with:

   ```json
   {
     "url": "https://chatgpt.com/",
     "text": "say hello",
     "prompt_type": "edit-context"
   }
   ```

   You get a **ticket**.

5. In the chatbot tab, click **Apply Response**.
6. Call **`poll_cwc_response`** with the ticket → it returns the chatbot reply.

If that works, the MCP server ↔ extension pipeline is healthy.

---

## 5. Test Jazz — headless (no browser)

This proves the full request/response sync between two Node peers, no extension
needed.

```bash
CWC_RUN_JAZZ_SCHEMA_ADMIN_CHECK=1 scripts/test-jazz-canary.sh   # must pass first
CWC_RUN_JAZZ_ROUNDTRIP=1 scripts/test-jazz-roundtrip.sh         # then the roundtrip
```

- The **canary** confirms the local Jazz server can publish schemas. It should
  **pass**. (If it fails, schema sync is broken — fix that before going further.)
- The **roundtrip** inserts a request as one peer and echoes a response as
  another; expect `pass 1`.

---

## 6. Test Jazz — live, with the real extension

The full local-first roundtrip: MCP server → Jazz sync server → extension →
back. Use **three terminals**.

**Terminal 1 — standalone Jazz sync server (leave running):**

```bash
scripts/jazz-server.sh
```

It prints the app id (also in `.jazz/app-id`) and listens on port 1625.

**Terminal 2 — publish the schema (once; re-run only if schema/permissions change):**

```bash
npx jazz-tools@alpha deploy "$(cat .jazz/app-id)" \
  --schema-dir packages/shared/src/jazz \
  --server-url http://localhost:1625 \
  --admin-secret cwc-rt-admin
```

Expect `Published the current schema …` and `Published permissions …`.

**Configure the extension** — in its service-worker console, paste your app id:

```js
chrome.storage.local.set({
  cwc_jazz_enabled: true,
  cwc_jazz_app_id: 'PASTE_FROM_cat_.jazz/app-id',
  cwc_jazz_server_url: 'ws://localhost:1625'
})
```

Then reload the extension in `chrome://extensions`.

**Terminal 3 — run the live driver:**

```bash
scripts/test-jazz-live.sh
```

It inserts a request row and waits for the extension to drive the chatbot and
write the response. Success looks like:

```text
SUCCESS. Response text: …
```

That's the complete MCP ↔ extension Jazz roundtrip.

### Driving via the Inspector instead

If you prefer the UI (and to actually click Apply Response yourself), use:

```bash
scripts/inspect-jazz.sh
```

with Terminals 1–2 running, then `send_to_codewebchat` → Apply Response →
`poll_cwc_response` in the UI.

---

## 7. Troubleshooting

| Symptom                                           | Cause / Fix                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot find package '@modelcontextprotocol/sdk'` | Dependencies not installed — run `scripts/build.sh` (or `pnpm install`).                                                                                                                                                                              |
| `Server error: invalid character: found 'w' at 2` | Jazz app id must be a **UUID**, not a name. The scripts persist one in `.jazz/app-id`; pass `JAZZ_APP_ID` only if it's a valid UUID.                                                                                                                  |
| `Invalid transport type: jazz` from the Inspector | The Inspector CLI hijacks `--transport` for itself. Use the `scripts/inspect-*.sh` wrappers — they pass the server transport via `CWC_TRANSPORT` env, not a flag.                                                                                     |
| `poll_cwc_response` / live driver stays pending   | Check the extension service-worker console: did the Jazz client connect to `ws://localhost:1625`, load the WASM (no CSP error), and is its `chat_requests` subscription firing? Confirm the extension's `cwc_jazz_app_id` matches `cat .jazz/app-id`. |
| Live roundtrip works sometimes, hangs other times | Ensure you're on the build that calls `.wait({ tier: 'edge' })` on the extension's response insert — without it the reply can be lost when the MV3 service worker sleeps.                                                                             |
| `Cannot find native binding`                      | `jazz-napi` has no Linux-arm64 binary. On a Mac this shouldn't happen; if it does, re-run `pnpm install`.                                                                                                                                             |

---

## Reference: what each script does

| Script                   | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `build.sh`               | Install deps + build MCP server and extension                   |
| `test.sh`                | Automated MCP server test suite                                 |
| `inspect-ws.sh`          | Drive the server (ws/clipboard) via MCP Inspector               |
| `inspect-jazz.sh`        | Drive the server (jazz, external sync server) via MCP Inspector |
| `jazz-server.sh`         | Start the standalone Jazz sync server (port 1625)               |
| `test-jazz-canary.sh`    | Schema-admin canary — run first after any jazz upgrade          |
| `test-jazz-roundtrip.sh` | Two-peer Jazz roundtrip (no browser)                            |
| `test-jazz-mcp-e2e.sh`   | Headless E2E (MCP + simulated browser peer)                     |
| `test-jazz-live.sh`      | Live roundtrip against the real Chrome extension                |

## Defaults

- Jazz app id: persisted UUID in `.jazz/app-id`
- Sync server: `ws://localhost:1625`
- Admin secret: `cwc-rt-admin` · Backend secret: `cwc-rt-backend`
- Default transport stays `ws`; Jazz is opt-in via `CWC_TRANSPORT=jazz` /
  `--transport jazz`.
