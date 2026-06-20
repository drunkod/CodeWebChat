# review-handoff scripts (MVP, option 1)

Wraps the existing host-mode `cwc-mcp-server` to run the Zed → ChatGPT review
handoff. No new server code. Plan: `plans/review-handoff-plan/`.

## Pipeline

```bash
# 1. capture the change as a packet (push first, read remote SHA)
bash scripts/review-handoff/build-packet.sh main \
  "Architecture drift, coupling, and boundaries. Skip nits." \
  "Refactored the bridge into a transport seam + request registry." > packet.json

# 2. fill the handoff prompt
node scripts/review-handoff/fill-handoff.mjs packet.json > handoff-prompt.txt

# 3. send it via the MCP server (from Zed / Inspector):
#    send_to_codewebchat { url: <chatgpt project>, text: <handoff-prompt.txt>, prompt_type: "edit-context" }
#    poll_cwc_response { ticket } until status:"done"  → save response to review.txt

# 4. parse the review's JSON block
node scripts/review-handoff/parse-review.mjs < review.txt > review.json

# 5. safety: record + check the reviewed SHA
mkdir -p .review-handoff
python3 -c 'import json;print(json.load(open("packet.json"))["commit_sha"])' \
  > .review-handoff/last-reviewed-sha
bash scripts/review-handoff/check-sha.sh   # warns if HEAD drifted

# fallback if the transport is down:
bash scripts/review-handoff/fallback.sh handoff-prompt.txt "https://chatgpt.com/g/<project>" "CWC_NO_BROWSER"
```

## Notes
- `CWC_NO_PUSH=1 bash build-packet.sh` uses the local HEAD (no push) — handy for
  dry-runs on a branch you don't want to push.
- Keep `.review-handoff/`, `packet.json`, `handoff-prompt.txt`, `review.txt`,
  `review.json` out of git (they're local round state).
