# Step 7 — Fallback (M7)

Goal: the loop is never blocked by the transport. If `send_to_codewebchat` /
`poll_cwc_response` fail, fall back to a manual copy-paste handoff.

## 7.1 When to fall back

Trigger on unrecoverable tool errors from Step 4:
`CWC_NO_BROWSER`, `CWC_PORT_IN_USE`, repeated `CWC_TIMEOUT`, `CWC_BROWSER_GONE`,
`CWC_NOT_CONNECTED`.

## 7.2 The fallback (full example)

`scripts/review-handoff/fallback.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Usage: fallback.sh handoff-prompt.txt "<chatgpt project url>" "<error message>"

PROMPT_FILE="${1:?need handoff prompt file}"
TARGET_URL="${2:-https://chatgpt.com/}"
ERR="${3:-transport unavailable}"

cat >&2 <<MSG
─────────────────────────────────────────────
  Review handoff transport failed: $ERR
  Manual fallback — do this by hand:
   1) Open: $TARGET_URL
   2) Paste the handoff prompt below into the chat.
   3) When ChatGPT replies, paste its answer back to your agent / review.json.
─────────────────────────────────────────────
MSG

echo "----- BEGIN HANDOFF PROMPT -----"
cat "$PROMPT_FILE"
echo "----- END HANDOFF PROMPT -----"

# Best-effort: open the page (macOS). Zed also exposes a `zed: open browser` action.
command -v open >/dev/null && open "$TARGET_URL" || true
```

Run (from Step 4's error path):

```bash
bash scripts/review-handoff/fallback.sh handoff-prompt.txt \
  "https://chatgpt.com/g/<project>" "CWC_NO_BROWSER"
```

## 7.3 In-editor fallback (optional, stronger)

If the browser flow is entirely unavailable, fall back to a **local** review:
Zed has `git: review diff`, which opens the branch diff in an agent review thread.
So even with no transport, the developer can still get a review path — just
local, not the GitHub-connected ChatGPT one.

## Design note

The handoff *request* is always reproducible (it's just the filled prompt), so the
fallback is trivial: print it. This is exactly why the design isn't
clipboard-dependent for input — the structured prompt is the source of truth, and
the clipboard is only the *return* convenience (removed by Phase C).

## Done when

Killing the browser connection mid-flow makes the agent print the full handoff
prompt + open the ChatGPT page, so you can complete the review manually.
