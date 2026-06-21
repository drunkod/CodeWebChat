#!/usr/bin/env bash
# Jazz schema-admin canary: does the local Jazz server expose
# /apps/{appId}/admin/schemas (required for cross-peer table sync)?
#
# Run this FIRST after any jazz-tools upgrade. If it fails/times out, the
# roundtrip cannot work yet — don't bother debugging the browser path.
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

cwc_section "build cwc-mcp-server"
cwc_run pnpm --filter cwc-mcp-server build

cwc_section "Jazz schema-admin canary (CWC_RUN_JAZZ_SCHEMA_ADMIN_CHECK=1)"
cwc_warn "Should PASS on alpha.51. (The earlier 404 was caused by a non-UUID app id, not a missing endpoint.) A failure here means schema publish/cross-peer sync is broken."
CWC_RUN_JAZZ_SCHEMA_ADMIN_CHECK=1 \
  cwc_run node --test apps/mcp-server/dist/jazz-sync-server.test.js
