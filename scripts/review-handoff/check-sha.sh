#!/usr/bin/env bash
# Warn if the branch has drifted from the reviewed commit.
# Usage: check-sha.sh [reviewed_sha]
#   reviewed_sha  default: read from .review-handoff/last-reviewed-sha
# Exit 0 = match (or unknown); exit 1 = drift detected.
set -euo pipefail

REVIEWED_SHA="${1:-$(cat .review-handoff/last-reviewed-sha 2>/dev/null || true)}"
if [ -z "$REVIEWED_SHA" ]; then
  echo "check-sha: no recorded reviewed SHA; cannot verify drift." >&2
  exit 0
fi

DRAFT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "origin/$DRAFT_BRANCH" 2>/dev/null || echo "")"

if [ "$LOCAL_HEAD" = "$REVIEWED_SHA" ] || [ "$REMOTE_HEAD" = "$REVIEWED_SHA" ]; then
  echo "OK: HEAD matches reviewed commit $REVIEWED_SHA"
  exit 0
fi

cat >&2 <<MSG
WARN: branch has drifted from the reviewed commit.
  reviewed : $REVIEWED_SHA
  local    : $LOCAL_HEAD
  remote   : ${REMOTE_HEAD:-<none>}
This review may not apply cleanly. Re-review the current HEAD, or apply carefully.
MSG
exit 1
