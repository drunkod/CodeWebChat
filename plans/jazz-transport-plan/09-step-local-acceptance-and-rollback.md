# Step 9 — Local acceptance test & rollback

Prove the full local loop end to end, then flip the default. Keep the WS bridge as
the rollback path the whole time.

## 9.1 Run the local stack

```bash
# 1. build both
nix develop path:/Users/test/Documents/work/CodeWebChat --command pnpm -r build

# 2. start the MCP server in Jazz mode (spawns the local sync server)
#    Register in your MCP client (Zed/Claude Desktop) with:
#      args: [".../apps/mcp-server/dist/index.js", "--transport", "jazz"]
#    and env JAZZ_APP_ID set to a stable UUID the extension also uses.

# 3. load the extension build with the Jazz feature flag ON, same JAZZ_APP_ID + serverUrl.
```

## 9.2 Acceptance checklist

```text
[ ] MCP server (--transport jazz) starts; local Jazz sync server bound on JAZZ_PORT.
[ ] cwc_status → browser_connected:true (presence) or at least connected:true.
[ ] request_review / send_to_codewebchat → inserts a chat_requests row.
[ ] Extension subscription fires → opens chatbot, fills prompt.
[ ] Reply captured as text → extension inserts chat_responses(response_text).
[ ] MCP server's subscription routes it → tool returns the text.
[ ] NO OS clipboard involved: put junk on the clipboard first; the tool still
    returns the real reply (proves the row carries it).
[ ] NO port 55155 / WS relay used (it's the fallback, not this path).
[ ] Pull the network/internet — the whole loop still works (all localhost).
[ ] Kill the extension service worker mid-request; on restart the subscription
    replays the pending row and the request completes.
```

The "junk on the clipboard" and "pull the network" checks are the two that prove
the *value*: clipboard-free and truly local.

## 9.3 Flip the default (only after green)

Change the default in `parseTransportKind` (Step 1) from `ws` to `jazz`, or set
`CWC_TRANSPORT=jazz` in the MCP client config. Keep `--transport ws` working.

## 9.4 Rollback (always available)

The WS path is never removed:

```text
[ ] Set --transport ws (or CWC_TRANSPORT=ws) → instant return to the relay+clipboard path.
[ ] Extension feature flag OFF → legacy WebSocket client.
[ ] No schema/permission deploy needed to roll back (Jazz code is dormant when ws).
```

A single flag flips the whole transport. Because `RequestRegistry` and the tools
are transport-agnostic, neither side of the rollback touches business logic.

## 9.5 Update the task lists

- Mark the Jazz path "validated (local)" here.
- Note that **Phase C (clipboard removal)** in `plans/mcp-server-prototype-plan` is
  now satisfied by the Jazz transport for the `jazz` path (the `ws` path still uses
  the clipboard).

## Done when

- The full checklist passes, including clipboard-junk and network-off.
- Default transport flipped to `jazz` (or documented as opt-in), with `ws` rollback
  proven.
