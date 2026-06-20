# Step 1 — Register the host-mode server in Zed (M1)

Goal: Zed's Agent Panel can call `cwc_status`, `send_to_codewebchat`, and
`poll_cwc_response` from the existing host-mode `cwc-mcp-server`.

## Prereqs

- `pnpm --filter cwc-mcp-server build` → `apps/mcp-server/dist/index.js` exists.
- CodeWebChat **browser extension** installed.
- Port `55155` free (close the VS Code extension — host mode owns that port).

## 1.1 Get the absolute node path (avoid the GUI PATH trap)

GUI apps (Zed) don't inherit your shell PATH, so `"command": "node"` will fail
when node comes from Nix. Use an absolute path:

```bash
nix develop path:/Users/test/Documents/work/CodeWebChat --command which node
# → /nix/store/<hash>-nodejs-22.x/bin/node   (copy this)
```

## 1.2 Add the context server to Zed `settings.json`

Open Zed → `cmd-,` (settings) and add a `context_servers` entry:

```jsonc
{
  "context_servers": {
    "codewebchat": {
      "source": "custom",
      "command": "/nix/store/<hash>-nodejs-22.x/bin/node",
      "args": [
        "/Users/test/Documents/work/CodeWebChat/apps/mcp-server/dist/index.js",
        "--mode", "host"
      ],
      "env": {}
    }
  }
}
```

> Verify the `context_servers` schema against your installed Zed version — key
> names have shifted across releases. The essentials never change: an absolute
> `command` (node) and `args` ending in `--mode host`.

## 1.3 Confirm the tools are live

1. Connect the CodeWebChat browser extension (open a chatbot tab; the extension
   polls `http://localhost:55155/health` and connects).
2. In Zed's Agent Panel, the `codewebchat` server should list three tools.
3. Ask the agent: *"call cwc_status"* → expect:

```json
{
  "mode": "host",
  "hosting": true,
  "websocket_connected": true,
  "client_id": 1,
  "browser_connected": true,
  "connected_browser_count": 1
}
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server won't start in Zed | `node` not found (PATH) | use the absolute Nix node path (1.1) |
| `CWC_PORT_IN_USE` on first call | VS Code extension owns 55155 | close VS Code, or run client mode |
| `browser_connected: false` | extension not connected to a tab | open a chatbot tab; re-check `cwc_status` |
| Tools not listed | wrong `context_servers` schema | check Zed's current settings docs |

## Done when

`cwc_status` returns `mode: host, hosting: true, browser_connected: true` from
**inside Zed**. That proves the transport is wired; Steps 2–8 build the handoff on
top of it.
