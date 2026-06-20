# Step 4 — Send the review request (M4, the MVP heartbeat)

Goal: fill the handoff prompt from `packet.json`, send it to the GitHub-connected
ChatGPT page via the existing `send_to_codewebchat`, and `poll_cwc_response` until
the review comes back.

## 4.1 Fill the prompt

```bash
node scripts/review-handoff/fill-handoff.mjs packet.json \
  plans/review-handoff-plan/templates/handoff.txt > handoff-prompt.txt
```

## 4.2 Send (the tool call the Zed agent makes)

```jsonc
// send_to_codewebchat
{
  "url": "https://chatgpt.com/g/<your-project-or-chat-id>",  // GitHub-connected ChatGPT page
  "text": "<contents of handoff-prompt.txt>",
  "prompt_type": "edit-context"   // ensures the CodeWebChat Apply Response button appears
}
// → { "status": "pending", "ticket": "<uuid>", "next": "...click Apply Response..." }
```

Notes:
- `url` should be your **persistent ChatGPT project** with the repo connected, so
  each review reuses the GitHub context. (Decision in `docs/.../01-...`: confirm
  the exact URL shape.)
- The reviewer **system prompt** (`prompts/` §1) is set once on the ChatGPT side
  (project instructions); the handoff prompt is the per-review message.

## 4.3 Poll until done

```jsonc
// poll_cwc_response — repeat until status:"done"
{ "ticket": "<uuid>", "wait_ms": 15000 }
// → { "status": "pending", "ticket": "<uuid>" }   (before you click Apply)
// → { "status": "done", "response": "<the full review text + JSON block>" }
```

You click CodeWebChat **Apply Response** on the ChatGPT reply; the next `poll`
returns `done` with the review text. Each `poll` returns in ≤30s, so a long human
delay between clicks never trips the client timeout.

## 4.4 Driving it from the Zed agent (natural-language recipe)

A single agent instruction for the MVP:

```text
1. Run build-packet.sh to produce packet.json (base: main, focus: <preset>).
2. Run fill-handoff.mjs to produce handoff-prompt.txt.
3. Call send_to_codewebchat with url=<chatgpt project url>, text=<handoff-prompt.txt>, prompt_type="edit-context".
4. Tell me to click Apply Response in the ChatGPT tab.
5. Call poll_cwc_response with the ticket until status is "done".
6. Show me the review and parse its JSON block (Step 5).
```

## 4.5 Error handling (map to Step 7 fallback)

| Error code | Meaning | Action |
| --- | --- | --- |
| `CWC_NO_BROWSER` | extension not connected | open a chatbot tab, retry |
| `CWC_PORT_IN_USE` | 55155 taken (VS Code) | close VS Code / use client mode |
| `CWC_TIMEOUT` | no Apply within `timeout_ms` | re-poll or re-send |
| `CWC_BROWSER_GONE` | browser dropped mid-request | retry the send |

On any unrecoverable error → Step 7 (print the filled prompt for manual paste).

## Done when

`poll_cwc_response` returns `status:"done"` with a review that includes both the
prose sections and the fenced ```json block.
