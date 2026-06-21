#!/usr/bin/env bash
# Real two-peer Jazz roundtrip integration test (no browser needed).
# Requires the native jazz-napi binary for your platform (macOS arm64/x64,
# Linux x64, Windows x64 — NOT Linux arm64).
#
# Usage:
#   scripts/test-jazz-roundtrip.sh          # normal
#   JAZZ_DEBUG=1 scripts/test-jazz-roundtrip.sh   # verbose Jazz server logs
#
# Outcomes:
#   pass 1                       -> Jazz cross-peer sync works on your setup.
#   "timed out waiting for rows" -> schema not on server; blocked upstream.
#   "Cannot find native binding" -> run scripts/build.sh (pnpm install) first.
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

TIMEOUT_MS="${CWC_JAZZ_TEST_TIMEOUT_MS:-30000}"

cwc_section "build cwc-mcp-server"
cwc_run pnpm --filter cwc-mcp-server build

cwc_section "Jazz roundtrip (CWC_RUN_JAZZ_ROUNDTRIP=1, timeout ${TIMEOUT_MS}ms)"
CWC_RUN_JAZZ_ROUNDTRIP=1 \
CWC_JAZZ_TEST_TIMEOUT_MS="$TIMEOUT_MS" \
JAZZ_DEBUG="${JAZZ_DEBUG:-0}" \
  cwc_run node --test apps/mcp-server/dist/jazz-roundtrip.test.js
