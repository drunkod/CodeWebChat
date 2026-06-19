# Step 7 — Blocking / human-in-the-loop tool calls 🔴 (decide before main-plan Step 3)

**This is your single hardest design problem, and `repo-harness` does not solve
it.** This step records what the developer said and proposes a concrete design.

> ⚠️ **This is a decision point, not a deferred task.** Resolve A vs C **before**
> you implement the tool in main-plan Step 3 (`03-step-register-mcp-tools.md`),
> because the choice changes the tool's **input schema** and **error codes**.
> Don't ship V0 with this undecided.

**Source:** the only blocking tool is `run_workflow_check`
(`draft/src/cli/mcp/tools.ts:694-702`) — a fixed 60s-timeout shell call. No
progress, no cancellation, no human-in-the-loop.

## Developer's answer (verbatim takeaway)

> "There is **no streaming, progress reporting, or cancellation**. The tool
> blocks synchronously and returns exit code + stdout/stderr. This works because
> the check completes in seconds."
>
> "For your `send_to_codewebchat` problem: this is the **hardest design gap** in
> the current codebase — there is no pattern here for a tool that blocks on
> human input. The MCP spec has `notifications/progress` and the SDK supports
> it, but it's not used here. Your options are:
> 1. Return immediately with a 'pending' token and poll via a second tool.
> 2. Block with a long timeout and accept the client may time out.
> 3. **Split into `send_to_chat` (returns immediately) + `poll_for_response`
>    (returns when ready or times out).**
> The repo has no answer for this — it's genuinely unsolved here."

So you are designing new ground. Below are the two viable shapes; option C/poll
is recommended.

## The constraint

`ApplyChatResponseMessage` does **not** carry the response text (your Step 1
research). The only signal you get is the user clicking **Apply Response** in
CodeWebChat, after which you read the OS clipboard. That click can come in 5
seconds or 5 minutes — or never. A single synchronous tool call cannot reliably
straddle that.

## Option A — single blocking tool with bounded timeout (simplest)

```ts
server.tool('send_to_codewebchat', /* schema with timeout_ms */, async (args) => {
  const before = await deps.read_clipboard()
  await bridge.sendPrompt(args.prompt, args.chatbot)
  const deadline = deps.now() + (args.timeout_ms ?? 120_000)
  while (deps.now() < deadline) {
    await deps.sleep(750)
    const applied = bridge.consumeApplyEvent()        // set when ApplyChatResponseMessage seen
    if (applied) {
      const after = await deps.read_clipboard()
      if (after && after !== before) return textResult({ response: redact(after).text })
      return errorResult('CLIPBOARD_UNCHANGED', 'Apply clicked but clipboard did not change')
    }
  }
  return errorResult('APPLY_TIMEOUT', `no Apply Response within ${args.timeout_ms ?? 120000}ms`)
})
```

Pros: one tool, easy for the model. Cons: MCP clients have their own request
timeouts (often 60s); a long human delay can break the call regardless of your
`timeout_ms`.

## Option C — split `send` + `poll` (recommended)

Decouples the client request timeout from human latency. Each call returns fast.

```ts
// 1) returns immediately with a ticket
server.tool('send_to_codewebchat', sendSchema, async (args) => {
  const before = await deps.read_clipboard()
  const ticket = bridge.beginRequest({ prompt: args.prompt, chatbot: args.chatbot, before })
  await bridge.sendPrompt(ticket)        // fire to the browser, do not wait
  return textResult({ ticket, status: 'pending',
    hint: 'Ask the user to click CodeWebChat "Apply Response", then call poll_chat_response with this ticket.' })
})

// 2) short, bounded poll the model can repeat
server.tool('poll_chat_response',
  { type:'object', properties:{ ticket:{type:'string'}, wait_ms:{type:'number', maximum:30000} },
    required:['ticket'], additionalProperties:false },
  { readOnlyHint: true, openWorldHint: true },
  async (args) => {
    const deadline = deps.now() + Math.min(args.wait_ms ?? 10_000, 30_000)
    while (deps.now() < deadline) {
      const r = bridge.checkRequest(args.ticket)            // { state, before }
      if (r.state === 'applied') {
        const after = await deps.read_clipboard()
        if (after && after !== r.before) return textResult({ status:'done', response: redact(after).text })
        return errorResult('CLIPBOARD_UNCHANGED', 'Apply clicked but clipboard unchanged')
      }
      if (r.state === 'unknown') return errorResult('INVALID_INPUT', `unknown ticket: ${args.ticket}`)
      await deps.sleep(500)
    }
    return textResult({ status:'pending', ticket: args.ticket })   // model calls again
  })
```

The server instruction (step 1) should tell the model the protocol: *send →
prompt the user to click Apply → poll until `done`.*

### Recommendation

Start with **Option C**. It survives client request timeouts, gives the user
unbounded time to click Apply, and keeps each tool call short — which also makes
it far easier to test with the injected clock from step 5. Keep `wait_ms`
capped (≤30s) so a single poll never itself trips a client timeout.

## Optional: progress notifications

If your MCP client supports `notifications/progress`, you can emit progress from
the long call (Option A) instead of polling. The developer flagged this exists
in the SDK but is unused upstream — treat it as a later enhancement, not V0.

## Checklist / decisions to confirm with the developer

- [ ] Decide A vs C (recommend C). Record the decision in your ADR (Step 7 of
      the main plan, `07-step-architect-decision-record.md`).
- [ ] Define ticket lifecycle + expiry in the bridge.
- [ ] How to detect a real Apply vs. stale clipboard (`before != after` guard +
      `CLIPBOARD_UNCHANGED` code).
- [ ] Confirm your target MCP client's request timeout — it dictates `wait_ms`.
