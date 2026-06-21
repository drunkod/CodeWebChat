#!/usr/bin/env bash
# Run the MCP server automated test suite (default env).
# Expected on macOS: 21 passed / 0 failed / 2 skipped.
# The 2 skipped are the gated Jazz tests (roundtrip + schema-admin canary).
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

cwc_section "cwc-mcp-server test suite"
cwc_run pnpm --filter cwc-mcp-server test
