#!/usr/bin/env bash
# Run cwc-mcp-server against an already-running standalone Jazz server.
#
# IMPORTANT: run this from inside `nix develop` (or another environment with Node
# and installed workspace deps). Do not wrap this script in `nix develop -c` when
# using it as an MCP stdio command: nix/shell banners can corrupt the MCP stdio
# handshake.
#
# Expected companion commands:
#   scripts/jazz-server.sh
#   npx jazz-tools@alpha deploy cwc-local-dev --server-url http://localhost:1625 --admin-secret cwc-rt-admin
#
# Override with JAZZ_APP_ID, JAZZ_SERVER_URL, or JAZZ_ADMIN_SECRET.
set -euo pipefail

CWC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CWC_ROOT"

if [[ "${IN_NIX_SHELL:-}" == "" && "${CWC_ALLOW_OUTSIDE_NIX:-0}" != "1" ]]; then
  cat >&2 <<'EOF'
error: run-jazz-external.sh must be launched from inside `nix develop`.

Reason: this script is intended for MCP stdio. Wrapping it in `nix develop -c`
can print shell banners to stdout and corrupt the MCP handshake.

Use:
  nix develop
  scripts/run-jazz-external.sh

If you know your environment is already clean, set CWC_ALLOW_OUTSIDE_NIX=1.
EOF
  exit 1
fi

# Jazz app IDs must be UUIDs. Reuse the persisted .jazz/app-id (created by
# jazz-server.sh) so the MCP server, the standalone server, and the extension
# all use the same id. Ignore a non-UUID JAZZ_APP_ID rather than crash the server.
APP_ID_FILE="$CWC_ROOT/.jazz/app-id"
uuid_re='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
if [[ -n "${JAZZ_APP_ID:-}" && ! "${JAZZ_APP_ID}" =~ $uuid_re ]]; then
  echo "warn: JAZZ_APP_ID='${JAZZ_APP_ID}' is not a UUID; using persisted .jazz/app-id" >&2
  unset JAZZ_APP_ID
fi
if [[ -z "${JAZZ_APP_ID:-}" ]]; then
  if [[ -f "$APP_ID_FILE" ]]; then
    JAZZ_APP_ID="$(cat "$APP_ID_FILE")"
  else
    mkdir -p "$(dirname "$APP_ID_FILE")"
    JAZZ_APP_ID="$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z' || true)"
    [[ -z "$JAZZ_APP_ID" ]] && JAZZ_APP_ID="$(node -e 'console.log(require("crypto").randomUUID())')"
    printf '%s' "$JAZZ_APP_ID" > "$APP_ID_FILE"
  fi
fi

export JAZZ_EXTERNAL_SERVER="${JAZZ_EXTERNAL_SERVER:-1}"
export JAZZ_APP_ID
export JAZZ_SERVER_URL="${JAZZ_SERVER_URL:-ws://localhost:1625}"
export JAZZ_BACKEND_SECRET="${JAZZ_BACKEND_SECRET:-cwc-rt-backend}"
export JAZZ_ADMIN_SECRET="${JAZZ_ADMIN_SECRET:-cwc-rt-admin}"
export CWC_TRANSPORT="${CWC_TRANSPORT:-jazz}"

exec node apps/mcp-server/dist/index.js
