#!/usr/bin/env bash
# Manual fallback when the MCP transport fails: print the prompt and open the page.
# Usage: fallback.sh <handoff-prompt.txt> [chatgpt_url] [error_message]
set -euo pipefail

PROMPT_FILE="${1:?need handoff prompt file}"
TARGET_URL="${2:-https://chatgpt.com/}"
ERR="${3:-transport unavailable}"

cat >&2 <<MSG
─────────────────────────────────────────────
  Review handoff transport failed: $ERR
  Manual fallback:
   1) Open: $TARGET_URL
   2) Paste the handoff prompt below into the chat.
   3) Paste ChatGPT's reply back to your agent (or save to review.txt).
─────────────────────────────────────────────
MSG

echo "----- BEGIN HANDOFF PROMPT -----"
cat "$PROMPT_FILE"
echo "----- END HANDOFF PROMPT -----"

# Best-effort open (macOS `open`, Linux `xdg-open`).
if command -v open >/dev/null 2>&1; then open "$TARGET_URL" || true
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$TARGET_URL" || true
fi
