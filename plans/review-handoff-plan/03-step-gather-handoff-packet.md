# Step 3 — Gather the handoff packet (M3)

Goal: after committing to a draft branch, collect the packet (repo, branches,
**remote** commit SHA, title, summary, changed files) that Steps 2/4 turn into the
review prompt. In the MVP, Zed's agent runs these git commands (or you run the
script below).

## 3.1 The git facts → packet fields

```bash
# from inside the repo working dir
BASE_BRANCH="main"                                  # your trunk
DRAFT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"   # e.g. draft/review-handoff

# PUSH FIRST, then read the REMOTE head — the reviewer reads GitHub, not local.
git push -u origin "$DRAFT_BRANCH"
COMMIT_SHA="$(git rev-parse "origin/$DRAFT_BRANCH")"

COMMIT_TITLE="$(git log -1 --pretty=%s "$COMMIT_SHA")"
REPO_URL="$(git remote get-url origin)"
# normalize git@github.com:owner/repo.git OR https://github.com/owner/repo.git -> owner/repo
REPO_NAME="$(printf '%s' "$REPO_URL" | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"

# changed files vs base (three-dot = since branch point)
mapfile -t CHANGED < <(git diff --name-only "$BASE_BRANCH...$COMMIT_SHA")
```

> **Why push-then-remote-SHA:** the research's #1 finding. The ChatGPT page inspects
> the commit *on GitHub*; a local-only SHA would point at code it can't see.

## 3.2 Build `packet.json` (full example script)

`scripts/review-handoff/build-packet.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="${1:-main}"
REVIEW_FOCUS="${2:-Correctness and regressions only. Assume the design is fixed.}"
SUMMARY="${3:-}"   # optional; if empty we fall back to the commit body

DRAFT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git push -u origin "$DRAFT_BRANCH" >/dev/null 2>&1 || true
COMMIT_SHA="$(git rev-parse "origin/$DRAFT_BRANCH" 2>/dev/null || git rev-parse HEAD)"
COMMIT_TITLE="$(git log -1 --pretty=%s "$COMMIT_SHA")"
[ -z "$SUMMARY" ] && SUMMARY="$(git log -1 --pretty=%b "$COMMIT_SHA")"
REPO_NAME="$(git remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"

# changed files as a JSON array
FILES_JSON="$(git diff --name-only "$BASE_BRANCH...$COMMIT_SHA" \
  | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')"

python3 - "$REPO_NAME" "$BASE_BRANCH" "$DRAFT_BRANCH" "$COMMIT_SHA" \
            "$COMMIT_TITLE" "$SUMMARY" "$REVIEW_FOCUS" "$FILES_JSON" <<'PY'
import json, sys
keys = ["repo_name","base_branch","draft_branch","commit_sha",
        "commit_title","change_summary","review_focus"]
vals = sys.argv[1:8]
packet = dict(zip(keys, vals))
packet["changed_files"] = json.loads(sys.argv[8])
print(json.dumps(packet, indent=2))
PY
```

Run:

```bash
bash scripts/review-handoff/build-packet.sh main \
  "Architecture drift, coupling, and boundaries. Skip nits." \
  "Refactored the bridge into a transport seam + request registry." > packet.json
```

Example `packet.json`:

```json
{
  "repo_name": "drunkod/CodeWebChat",
  "base_branch": "main",
  "draft_branch": "draft/review-handoff",
  "commit_sha": "a1b2c3d4e5f6...",
  "commit_title": "Extract CwcTransport seam + RequestRegistry",
  "change_summary": "Refactored the bridge into a transport seam + request registry.",
  "review_focus": "Architecture drift, coupling, and boundaries. Skip nits.",
  "changed_files": [
    "apps/mcp-server/src/transport.ts",
    "apps/mcp-server/src/host-transport.ts",
    "apps/mcp-server/src/request-registry.ts"
  ]
}
```

## 3.3 Optional: auto-summary / commit message

The editor already has commit-message prompt logic
(`apps/editor/src/utils/prompts-for-commit-messages-utils.ts`) and changed-file
sources (`apps/editor/src/commands/apply-context-command/sources/commit-files-source.ts`).
For the MVP just pass `--summary` or use the commit body; in v1, reuse that logic
to auto-fill `change_summary`.

## Done when

`packet.json` validates against the `HandoffPacket` shape (Step 2.1) and
`commit_sha` is the **remote** HEAD of the draft branch.
