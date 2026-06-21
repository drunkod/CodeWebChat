#!/usr/bin/env bash
# Shared helpers for CodeWebChat test scripts.
# Source this from the other scripts: . "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
set -euo pipefail

# Repo root = parent of the scripts/ dir.
CWC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CWC_ROOT"

# Run commands inside the nix dev shell by default.
# Set CWC_NO_NIX=1 to run directly (e.g. if you're already inside `nix develop`).
if [[ "${CWC_NO_NIX:-0}" == "1" ]]; then
  RUN=()
else
  if ! command -v nix >/dev/null 2>&1; then
    echo "error: 'nix' not found. Install nix, or run inside 'nix develop' with CWC_NO_NIX=1." >&2
    exit 1
  fi
  RUN=(nix develop -c)
fi

cwc_run() { "${RUN[@]}" "$@"; }

cwc_section() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
cwc_ok()      { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
cwc_warn()    { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }

# Jazz app IDs MUST be UUIDs — the standalone server parses them as a UUID and
# rejects friendly names (e.g. "cwc-local-dev" fails: "invalid character 'w'").
# Honors $JAZZ_APP_ID when it's a valid UUID; otherwise reads/creates a stable
# one in .jazz/app-id so the server, deploy, MCP, and extension all agree.
CWC_UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
cwc_app_id() {
  local f="$CWC_ROOT/.jazz/app-id"
  if [[ -n "${JAZZ_APP_ID:-}" && "${JAZZ_APP_ID}" =~ $CWC_UUID_RE ]]; then
    printf '%s' "$JAZZ_APP_ID"; return
  fi
  if [[ -n "${JAZZ_APP_ID:-}" ]]; then
    cwc_warn "JAZZ_APP_ID='${JAZZ_APP_ID}' is not a UUID; Jazz requires one. Using persisted .jazz/app-id instead."
  fi
  if [[ ! -f "$f" ]]; then
    mkdir -p "$(dirname "$f")"
    local id
    id="$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z' || true)"
    [[ -z "$id" ]] && id="$(node -e 'console.log(require("crypto").randomUUID())')"
    printf '%s' "$id" > "$f"
  fi
  cat "$f"
}
