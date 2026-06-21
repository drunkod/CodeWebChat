#!/usr/bin/env bash
# Install deps and build the MCP server + browser extension.
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

cwc_section "pnpm install"
cwc_run pnpm install

cwc_section "build cwc-mcp-server"
cwc_run pnpm --filter cwc-mcp-server build

cwc_section "build browser extension (gemini-coder-connector)"
cwc_run pnpm --filter gemini-coder-connector build

cwc_ok "Build complete. Extension is in apps/browser/dist (load unpacked in chrome://extensions)."
