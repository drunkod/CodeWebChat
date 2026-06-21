#!/usr/bin/env bash
# Drive the MCP server (ws/clipboard mode — the working path) via MCP Inspector.
# Opens a web UI (~http://localhost:6274). Connect (stdio), List Tools, then:
#   cwc_status -> send_to_codewebchat -> click Apply Response in the tab -> poll_cwc_response
#
# Load the extension (apps/browser/dist) with cwc_jazz_enabled:false first so it
# connects to the relay on :55155.
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

cwc_section "build cwc-mcp-server"
cwc_run pnpm --filter cwc-mcp-server build

# NOTE: the Inspector CLI hijacks --transport (it thinks it's its own
# stdio/sse/http flag). So we pass the server's mode/transport via env, not flags.
cwc_section "MCP Inspector -> cwc-mcp-server (host + ws, via env)"
CWC_MODE=host CWC_TRANSPORT=ws \
  cwc_run npx @modelcontextprotocol/inspector \
  node apps/mcp-server/dist/index.js
