#!/usr/bin/env bash
# Start the standalone Jazz sync server for local CodeWebChat Jazz transport.
# This is the full jazz-tools server, not the embedded startLocalJazzServer helper.
#
# Defaults match the local MCP/extension development setup:
#   app id:       a persisted UUID in .jazz/app-id (Jazz requires a UUID, not a name)
#   port:         1625
#   data dir:     ./.jazz/server
#   admin secret: cwc-rt-admin
#
# Override with JAZZ_APP_ID (must be a UUID), JAZZ_PORT, JAZZ_DATA_DIR, or JAZZ_ADMIN_SECRET.
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

JAZZ_APP_ID="$(cwc_app_id)"
JAZZ_PORT="${JAZZ_PORT:-1625}"
JAZZ_DATA_DIR="${JAZZ_DATA_DIR:-./.jazz/server}"
JAZZ_ADMIN_SECRET="${JAZZ_ADMIN_SECRET:-cwc-rt-admin}"

cwc_section "standalone Jazz sync server (appId=${JAZZ_APP_ID}, port=${JAZZ_PORT})"
cwc_warn "Leave this running. In another terminal, publish schema with: npx jazz-tools@alpha deploy ${JAZZ_APP_ID} --schema-dir packages/shared/src/jazz --server-url http://localhost:${JAZZ_PORT} --admin-secret ${JAZZ_ADMIN_SECRET}"

exec "${RUN[@]}" npx jazz-tools@alpha server "$JAZZ_APP_ID" \
  --port "$JAZZ_PORT" \
  --data-dir "$JAZZ_DATA_DIR" \
  --admin-secret "$JAZZ_ADMIN_SECRET" \
  --allow-local-first-auth
