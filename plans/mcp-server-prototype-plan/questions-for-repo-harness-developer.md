# Questions for the `repo-harness` developer

Context: you're building a small local MCP server (`cwc-mcp-server`) that bridges
MCP clients to the CodeWebChat browser extension over WebSocket. Your friend
built `repo-harness`, which has a mature MCP implementation (`src/cli/mcp/`).
These questions are ordered by how much the answer will change your plan — ask
the top ones first. Each notes *why you're asking* so you can steer the
conversation.

---

## A. Architecture & scope decisions (ask first — these shape everything)

1. **If you started the MCP server today, what would you keep and what would you
   throw away?** — Fastest way to learn what earned its place vs. what was
   over-engineered.
2. **How did you decide the boundary of "what the MCP server is allowed to
   do"?** You wrote "exposes workflow artifacts, not general filesystem access."
   How did you arrive at that line, and did you ever regret it being too tight or
   too loose? — Directly informs my own "prompt bridge, not editor control"
   boundary.
3. **Why split into `planner / executor / orchestrator` profiles instead of one
   server with all tools?** What problem did profiles actually solve in
   practice? — Helps me decide if I need profiles at all for two tools.
4. **stdio vs HTTP: when did you actually need HTTP**, and what broke or got
   harder once you supported both transports? — I'm stdio-only now; want to know
   the real cost of adding HTTP later.

## B. Safety & security (high value for me — I return clipboard contents)

5. **The redaction module — how did you choose the patterns, and have you had
   false positives/negatives in real use?** Would you trust it as the *only*
   layer protecting against leaking secrets? — I plan to copy it; want to know
   its limits.
6. **You hash tool inputs in the audit log instead of storing them raw. What
   incident or worry drove that?** — Validates whether I should do the same from
   day one.
7. **For the path policy (deny globs + traversal guard + maxFileBytes): what
   attacks or mistakes did it actually catch?** Anything you'd add today? — Only
   relevant if I add file tools, but I want the lessons.
8. **How do you think about a malicious or confused *calling model*** — i.e. the
   MCP client itself sending bad/hostile tool calls? What server-side
   assumptions do you make? — My bridge forwards prompts to a chatbot; I need a
   threat model.

## C. Tool design & protocol

9. **How did you settle on your tool granularity?** Any tool you later split or
   merged, and what was the signal that it was wrong? — I have 2 tools now and
   want to grow them well.
10. **Do you rely on `structuredContent` and `annotations`, and do clients
    actually honor them?** Worth the effort? — Deciding how much protocol polish
    to invest in for V0.
11. **How do you handle long-running / human-in-the-loop tool calls?** My
    `send_to_codewebchat` blocks until the user clicks "Apply Response" — how do
    you deal with tools that can't return immediately (timeouts, cancellation,
    progress)? — This is my single hardest design problem.
12. **How do you version the tool surface** so a client built against an old
    version doesn't break? — Planning my V0→V1 protocol upgrade (my Step 6).

## D. Testing, reliability & operations

13. **How do you test the MCP layer?** Do you mock the SDK transport, the
    process/effect calls, both? — My Step 5 mocks the WebSocket; want to compare
    approaches.
14. **What does `mcp doctor` check, and which failures were common enough to
    justify building it?** — I'm considering a `doctor` for my WebSocket +
    clipboard preconditions.
15. **What's the most common way the server fails in the field**, and how do you
    surface that to the user vs. the calling agent? — My clipboard/apply flow is
    fragile; want to learn good failure UX.
16. **How do you manage local state/config** (`.repo-harness/mcp.local.json`,
    token files) — any gotchas with file permissions, corruption, or multi-repo
    use? — I'll likely need a config file in V1.

## E. Process & learning (good closers)

17. **What MCP SDK version pitfalls or breaking changes have bitten you?** — Save
    me from known landmines.
18. **If you had a one-page "MCP server starter checklist," what's on it?** —
    Great forcing function for a concise answer I can turn into my plan.
19. **What part of the MCP spec do you wish you'd understood earlier?**
20. **Anything about CodeWebChat's WebSocket protocol specifically** (port
    `55155`, the `gemini-coder` / `gemini-coder-vscode` tokens, `ApplyChatResponseMessage`
    not carrying response text) **that you'd approach differently?** — Only if he
    knows CodeWebChat; otherwise drop.

---

## How to use the answers

Capture his answers inline under each question (or in a new
`developer-answers.md`). Then we'll:

1. Re-rank the feature list in `08-adapt-best-features-from-repo-harness.md`
   based on what he says earned its keep.
2. Resolve the open design problem in Q11 (blocking/human-in-the-loop calls)
   into a concrete approach.
3. Produce a detailed, step-by-step implementation plan for `cwc-mcp-server`.
