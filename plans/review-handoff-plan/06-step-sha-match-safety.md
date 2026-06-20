# Step 6 — SHA-match safety (M6)

Goal: never apply review feedback to code that has drifted from what was reviewed.
Each review round is traceable to one commit SHA.

## 6.1 The risk

In AI-assisted loops, the branch can move between "send for review" and "apply
feedback." If the reviewer commented on `a1b2c3` but HEAD is now `f6e5d4`, the
fixes may not apply cleanly — or worse, silently target the wrong code.

## 6.2 Record the reviewed SHA

The packet already carries `commit_sha`. Persist it alongside the review:

```bash
# after Step 4 returns done, stash the SHA you reviewed
echo "$(python3 -c 'import json,sys;print(json.load(open("packet.json"))["commit_sha"])')" \
  > .review-handoff/last-reviewed-sha
```

(Keep `.review-handoff/` gitignored — it's local round state.)

## 6.3 Gate before applying feedback (full example)

`scripts/review-handoff/check-sha.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

REVIEWED_SHA="$(cat .review-handoff/last-reviewed-sha 2>/dev/null || true)"
if [ -z "$REVIEWED_SHA" ]; then
  echo "WARN: no recorded reviewed SHA; cannot verify drift." >&2
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
```

## 6.4 MVP vs v1 behavior

- **MVP:** `check-sha.sh` **warns** (non-fatal) — the agent surfaces the message
  before the feedback-back prompt. The developer decides.
- **v1:** the `import_review_feedback` tool makes this a **hard gate** — it refuses
  to emit a fix plan if HEAD ≠ reviewed SHA unless `--force` is passed.

## Done when

Applying feedback after an extra commit prints the drift warning (and matches
cleanly when HEAD is unchanged).
