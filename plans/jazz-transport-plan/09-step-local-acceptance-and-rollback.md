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
[ ] Reply returns correctly via the Jazz path (clipboard capture OR inline
    response_text — both are acceptable; clipboard is retained).
[ ] (Optional inline-mode check) With use_clipboard_fallback=false and an inline
    response_text, the reply still returns. This is a capability check, NOT a
    requirement — clipboard mode stays supported.
[ ] NO port 55155 / WS relay used (it's the fallback, not this path).
[ ] Pull the network/internet — the whole loop still works (all localhost).
[ ] Kill the extension service worker mid-request; on restart the subscription
    replays the pending row and the request completes.
```

The "pull the network" check proves the core value: truly local. The reply may
arrive via clipboard or inline row — clipboard support is intentionally kept, so a
"clipboard-free" run is an optional capability demo, not an acceptance gate.

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
- Note that the Jazz transport adds an **inline reply option** (`response_text` in
  the row) **alongside** the retained clipboard path. This is additive — "Phase C"
  is reframed as "inline reply is now available," not "clipboard removed." Clipboard
  stays supported on both the `ws` and `jazz` paths.

## Done when

- The full checklist passes (reply returns via clipboard or inline row; network-off
  still works). The clipboard-free run is an optional capability demo, not required.
- Default transport flipped to `jazz` (or documented as opt-in), with `ws` rollback
  proven.
