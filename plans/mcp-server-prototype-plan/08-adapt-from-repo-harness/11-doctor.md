# Step 11 — `doctor` self-diagnostics (V0 ⬆️ promoted)

> ⚠️ **Promoted from V1 to V0** on the developer's review. Your stated hardest
> failure mode is the fragile WebSocket + clipboard flow. A doctor that checks
> `localhost:55155` reachability and clipboard access costs ~30 lines and
> directly de-risks that — it's worth more at V0 than the audit log.

**Source:** `draft/src/cli/mcp/setup.ts:394-443` (`runMcpDoctor`),
`harness_doctor` MCP tool at `draft/src/cli/mcp/tools.ts:516-538`.

## Developer's answer

> "`runMcpDoctor` checks: local config exists, guide exists, auth configured,
> Codex CLI available, `.codex/config.toml` has the server block, all required
> tools listed. **The most common failure was Codex config missing tools** —
> `missingTools` is a diff of required tools against the config. Each failure
> ships an **actionable fix command**."
>
> "For your WebSocket + clipboard doctor: check (1) WebSocket reachable, (2)
> clipboard API available, (3) CodeWebChat responding on port 55155. Return a
> fix command for each failure."

The pattern that makes `doctor` good: **every failed check carries the exact
command/step to fix it.**

## Source shape

```ts
const report = {
  status: adopted ? 'ready_local' : 'not_adopted',
  mcp:    { localConfig, guide, authConfigured },
  codex:  { cliAvailable, configured, missingTools,
            fix: 'repo-harness mcp setup codex --repo . --scope project' },  // actionable
}
```

## Adapt to `cwc-mcp-server`

Turn your fragile preconditions into a one-command check — directly useful given
the semi-automated clipboard flow:

```ts
// apps/mcp-server/src/doctor.ts
export async function doctor(deps) {
  const checks = []

  // 1. WebSocket bridge reachable on 55155
  const ws = await deps.tryConnect('ws://localhost:55155', 'gemini-coder-vscode').catch(() => null)
  checks.push(ws
    ? { name: 'websocket', ok: true }
    : { name: 'websocket', ok: false,
        fix: 'Open VS Code with the CodeWebChat extension running; it hosts the WS server on localhost:55155.' })

  // 2. Browser client registered
  const status = ws ? await deps.bridge.status() : null
  checks.push(status?.browserConnected
    ? { name: 'browser', ok: true }
    : { name: 'browser', ok: false,
        fix: 'Open a supported chatbot tab and connect the CodeWebChat browser extension (token "gemini-coder").' })

  // 3. Clipboard readable
  const clip = await deps.read_clipboard().then(() => true).catch(() => false)
  checks.push(clip
    ? { name: 'clipboard', ok: true }
    : { name: 'clipboard', ok: false,
        fix: 'Grant clipboard read permission to the MCP host process (macOS: System Settings > Privacy).' })

  return { ok: checks.every(c => c.ok), checks }
}
```

Expose it two ways (as repo-harness does — a CLI command **and** an MCP tool):

- CLI: `cwc-mcp-server doctor` for the user setting things up.
- MCP tool `cwc_doctor` (read-only) so the calling agent can self-diagnose
  before `send_to_codewebchat` and give the user the right fix.

Also surface the config-corruption warning from step 9 here.

## Checklist

- [ ] Checks: WS on 55155, browser client registered, clipboard readable.
- [ ] Every failed check has a concrete `fix` string.
- [ ] Exposed as both a CLI command and a read-only MCP tool.
- [ ] Reports config-load warnings (step 9).
