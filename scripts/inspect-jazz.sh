#!/usr/bin/env bash
# Drive the MCP server in JAZZ mode via MCP Inspector, against the WORKING
# standalone Jazz server (jazz-tools@alpha server) — not the embedded helper.
# Opens a web UI (~http://localhost:6274).
#
# Prereqs (the standalone path that actually syncs):
#   1. scripts/jazz-server.sh                       # leave running (terminal 1)
#   2. deploy the schema once (terminal 2):
#        npx jazz-tools@alpha deploy "$(cat .jazz/app-id)" \
#          --schema-dir packages/shared/src/jazz \
#          --server-url http://localhost:1625 --admin-secret cwc-rt-admin
#   3. this script (terminal 3)
#
# In the UI: Connect -> List Tools -> cwc_status -> send_to_codewebchat (ticket).
# With the schema deployed, the extension can pick up the request and a real
# poll_cwc_response roundtrip can complete.
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

JAZZ_APP_ID="$(cwc_app_id)"
JAZZ_SERVER_URL="${JAZZ_SERVER_URL:-ws://localhost:1625}"
JAZZ_ADMIN_SECRET="${JAZZ_ADMIN_SECRET:-cwc-rt-admin}"

cwc_section "build cwc-mcp-server"
cwc_run pnpm --filter cwc-mcp-server build

# NOTE: the Inspector CLI hijacks --transport (it treats it as its own
# stdio/sse/http flag), so the server transport is selected via CWC_TRANSPORT env.
# JAZZ_EXTERNAL_SERVER=1 means: connect to the standalone server above, don't
# spawn the (broken) embedded one.
cwc_section "MCP Inspector -> cwc-mcp-server (jazz, external server, appId=${JAZZ_APP_ID})"
cwc_warn "Requires scripts/jazz-server.sh running + schema deployed (see header)."
JAZZ_EXTERNAL_SERVER=1 \
JAZZ_APP_ID="$JAZZ_APP_ID" \
JAZZ_SERVER_URL="$JAZZ_SERVER_URL" \
JAZZ_ADMIN_SECRET="$JAZZ_ADMIN_SECRET" \
CWC_TRANSPORT=jazz \
  cwc_run npx @modelcontextprotocol/inspector \
  node apps/mcp-server/dist/index.js
