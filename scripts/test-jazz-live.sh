#!/usr/bin/env bash
# Live Jazz roundtrip against the REAL Chrome extension (no fake peer).
# Inserts a chat_requests row and waits for the extension to write the response.
#
# Prereqs (all must be running/done first):
#   1. scripts/jazz-server.sh                    # standalone server on :1625
#   2. deploy the schema once:
#        npx jazz-tools@alpha deploy "$(cat .jazz/app-id)" \
#          --schema-dir packages/shared/src/jazz \
#          --server-url http://localhost:1625 --admin-secret cwc-rt-admin
#   3. Chrome: load apps/browser/dist, enable Jazz in the SW console with the
#      SAME app id (cat .jazz/app-id) + ws://localhost:1625, reload the extension.
#
# Override timeout with CWC_LIVE_TIMEOUT_MS (default 30000).
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

cwc_section "build shared (schema/permissions dist for the driver)"
cwc_run pnpm --filter shared build

cwc_section "live Jazz roundtrip driver"
cwc_warn "Requires the standalone server, a deployed schema, and the Chrome extension running with Jazz enabled (same app id)."
cwc_run pnpm --filter cwc-mcp-server exec tsx src/live-test-sync.ts
