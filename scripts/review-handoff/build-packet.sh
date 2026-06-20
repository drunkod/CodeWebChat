#!/usr/bin/env bash
# Build a review handoff packet.json from the current git state.
# Usage: build-packet.sh [base_branch] [review_focus] [summary]
#   base_branch   default: main
#   review_focus  default: a "bug risk" preset
#   summary       optional; falls back to the commit body
#
# Env:
#   CWC_NO_PUSH=1   skip "git push" (use the local HEAD instead of remote)
set -euo pipefail

BASE_BRANCH="${1:-main}"
REVIEW_FOCUS="${2:-Correctness and regressions only. Assume the design is fixed.}"
SUMMARY="${3:-}"

DRAFT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# Push first, then read the REMOTE head — the reviewer reads GitHub, not local.
if [ "${CWC_NO_PUSH:-0}" != "1" ]; then
  git push -u origin "$DRAFT_BRANCH" >/dev/null 2>&1 || \
    echo "build-packet: warning: push failed; using local HEAD" >&2
fi
COMMIT_SHA="$(git rev-parse "origin/$DRAFT_BRANCH" 2>/dev/null || git rev-parse HEAD)"

COMMIT_TITLE="$(git log -1 --pretty=%s "$COMMIT_SHA")"
[ -z "$SUMMARY" ] && SUMMARY="$(git log -1 --pretty=%b "$COMMIT_SHA")"
[ -z "$SUMMARY" ] && SUMMARY="$COMMIT_TITLE"

REPO_NAME="$(git remote get-url origin 2>/dev/null \
  | sed -E 's#^.*github\.com[:/]##; s#\.git$##' || echo 'unknown/unknown')"

# changed files vs base (three-dot = since branch point). If the base ref is
# unknown locally, fall back to the last commit's files. Capture into a var first
# so a failed diff can't corrupt the JSON.
if git rev-parse --verify --quiet "$BASE_BRANCH" >/dev/null 2>&1; then
  CHANGED="$(git diff --name-only "${BASE_BRANCH}...${COMMIT_SHA}" 2>/dev/null || true)"
else
  echo "build-packet: base '$BASE_BRANCH' not found locally; using last commit's files" >&2
  CHANGED="$(git diff --name-only "${COMMIT_SHA}~1" "${COMMIT_SHA}" 2>/dev/null || true)"
fi
FILES_JSON="$(printf '%s\n' "$CHANGED" \
  | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')"

python3 - "$REPO_NAME" "$BASE_BRANCH" "$DRAFT_BRANCH" "$COMMIT_SHA" \
            "$COMMIT_TITLE" "$SUMMARY" "$REVIEW_FOCUS" "$FILES_JSON" <<'PY'
import json, sys
keys = ["repo_name","base_branch","draft_branch","commit_sha",
        "commit_title","change_summary","review_focus"]
packet = dict(zip(keys, sys.argv[1:8]))
packet["changed_files"] = json.loads(sys.argv[8])
print(json.dumps(packet, indent=2))
PY
