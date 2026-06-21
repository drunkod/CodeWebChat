# Zed MVP setup (option 1 — prompt-driven, zero new server code)

Concrete steps for the locked MVP. Goal: in Zed, after the AI finishes, one
command sends a structured review request to the ChatGPT page and the review
returns into Zed — using the **existing** host-mode `cwc-mcp-server` and the
prompt pack in `prompts/`.

## Prereqs

- `cwc-mcp-server` builds (`pnpm --filter cwc-mcp-server build`) — done.
- The CodeWebChat **browser extension** installed in your browser.
- A **ChatGPT project** with your **GitHub repo connected** (the reviewer surface).
- Nothing else holding port `55155` (close the VS Code extension — host mode owns
  that port, or you'll get `CWC_PORT_IN_USE`).

---

## M1 — Register the host-mode server in Zed

Zed supports MCP/context servers in `settings.json`. Use the **absolute Nix node
path** (GUI apps don't inherit your shell PATH — same trap as Claude Desktop). Get
it with `nix develop path:/Users/test/Documents/work/CodeWebChat --command which node`.

```jsonc
// Zed settings.json
{
  "context_servers": {
    "codewebchat": {
      "source": "custom",
      "command": "/nix/store/<hash>-nodejs-22.x/bin/node",
      "args": [
        "/Users/test/Documents/work/CodeWebChat/apps/mcp-server/dist/index.js",
        "--mode",
        "host"
      ],
      "env": {}
    }
  }
}
```

> Verify the exact `context_servers` schema against your installed Zed version —
> the key names have changed across releases. The essentials are: a `command`
> (absolute node path) and `args` ending in `--mode host`.

**Check:** open Zed's Agent Panel → the `codewebchat` server should list
`cwc_status`, `send_to_codewebchat`, `poll_cwc_response`. Connect the browser
extension, then ask the agent to call `cwc_status` → expect
`mode: host, hosting: true, browser_connected: true`.

---

## M3 — Gather the handoff packet (Zed's own Git tools)

After committing to a draft branch, have the Zed agent collect:

| Field            | How (Zed agent / terminal)                                      |
| ---------------- | --------------------------------------------------------------- |
| `repo_name`      | `git remote get-url origin` (owner/repo)                        |
| `base_branch`    | your main branch (e.g. `main`)                                  |
| `draft_branch`   | `git rev-parse --abbrev-ref HEAD` (e.g. `draft/<slug>`)         |
| `commit_sha`     | `git rev-parse HEAD` (after push: the **remote** HEAD)          |
| `commit_title`   | `git log -1 --pretty=%s`                                        |
| `change_summary` | the AI's summary of what it changed (or generate from the diff) |
| `changed_files`  | `git diff --name-only {{base_branch}}...HEAD`                   |
| `review_focus`   | pick a preset (see `prompts/` table)                            |

> Important (research's top finding): **push first, then read the remote HEAD SHA**
> so the reviewer inspects the code that's actually on GitHub, not a local commit
> the ChatGPT page can't see.

---

## M4 — Send the review request (the MVP heartbeat)

The agent fills the **handoff prompt** (`prompts/` §2) with the packet and calls:

```jsonc
send_to_codewebchat {
  "url": "https://chatgpt.com/g/<your-project-or-chat>",   // the GitHub-connected ChatGPT page
  "text": "<filled handoff prompt, including the request for the JSON block>",
  "prompt_type": "edit-context"      // triggers the Apply Response button
}
// → returns { ticket }
```

Then poll until done:

```jsonc
poll_cwc_response { "ticket": "<ticket>" }   // pending → … → done, with the review text
```

You click CodeWebChat **Apply Response** on the ChatGPT reply; the review text
comes back to Zed.

---

## M5 — Bring the review into Zed

The returned text contains the prose review **and** the JSON block. The agent:

- shows the prose in the thread, and
- parses the JSON (`verdict`, `risk`, `findings[]`, `tests[]`,
  `editor_patch_plan[]`) into actionable items.

Then use the **feedback-back prompt** (`prompts/` §3) to drive the fix pass in Zed.

---

## M6 — Safety: SHA-match check

Record the `commit_sha` you sent for review. Before applying feedback:

```sh
test "$(git rev-parse HEAD)" = "<reviewed_sha>"   # or compare remote HEAD
```

If HEAD moved, **warn**: "this review was for `<sha>`; your branch has advanced —
re-review or apply carefully." (Becomes a hard gate in v1.)

---

## M7 — Fallback

If `send_to_codewebchat` / `poll_cwc_response` errors (`CWC_NO_BROWSER`,
`CWC_PORT_IN_USE`, `CWC_TIMEOUT`), print the filled handoff prompt so you can paste
it into the ChatGPT page by hand. The loop must never be blocked by the transport.

---

## The MVP demo (do this once to prove it)

1. AI edits code in Zed → commit to `draft/<slug>` → push.
2. Agent gathers the packet (M3), fills the handoff prompt, calls
   `send_to_codewebchat` with the ChatGPT project URL (M4).
3. ChatGPT (GitHub-connected) reviews `commit_sha` → you Apply → review returns.
4. Agent parses verdict + findings; you run the feedback-back prompt to fix.
5. If you committed again meanwhile, the SHA-check warns (M6).

That round-trip = Review Handoff v0. Once it feels good, we promote the
`prepare_review_handoff` / `request_review` / `import_review_feedback` tools (v1)
and re-prioritize Phase C to add an inline reply path (clipboard retained as fallback).
