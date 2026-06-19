# Step 9 — Local config & secret file handling (V1)

**Source:** `draft/src/cli/mcp/auth.ts` (config + token paths, `0o600`),
`draft/src/cli/mcp/setup.ts:180-186` (gitignore entries).

## Developer's answer (the gotchas)

> Files: `.repo-harness/mcp.local.json` (config), `mcp.tokens.json` (bearer,
> `0o600`), `mcp.oauth.json` / `mcp.oauth-tokens.json`, `.ai/harness/mcp/audit.log`.
> Gotchas observed:
> 1. "Token files written with `mode: 0o600` — correct, but **Unix-only**.
>    Windows needs a different approach."
> 2. "TOML patching creates a `.bak` before mutation — safe, but backups
>    accumulate."
> 3. "`loadMcpLocalConfig` **silently returns `null` on parse error** —
>    corruption is swallowed, not surfaced."
> 4. A subtle mismatch between which file the doctor checks for adoption state vs.
>    the real marker.

## Source examples

```ts
// auth.ts — safe load (note the silent null on corruption)
export function loadMcpLocalConfig(repoRoot: string): McpLocalConfig | null {
  const path = mcpLocalConfigPath(repoRoot)
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf-8')) as McpLocalConfig }
  catch { return null }      // <- corruption swallowed; consider warning instead
}

// secret written with restrictive perms (Unix-only!)
writeFileSync(path, JSON.stringify({ version: 1, bearerToken: token }, null, 2) + '\n',
  { encoding: 'utf-8', mode: 0o600 })

// setup.ts — gitignore secrets automatically, from day one
ensureGitignoreEntries(repoRoot, [
  '.repo-harness/mcp.local.json',
  '.repo-harness/mcp.tokens.json',
  '.repo-harness/mcp.oauth.json',
  '.repo-harness/mcp.oauth-tokens.json',
  '.ai/harness/mcp/audit.log',
], changed)
```

## Adapt to `cwc-mcp-server`

You won't need config until you have more than a couple of knobs. When you do
(port `55155`, client tokens `gemini-coder` / `gemini-coder-vscode`,
apply-timeout default), use one `.cwc-mcp/config.json`:

```ts
// apps/mcp-server/src/config.ts
export interface CwcConfig {
  version: number
  wsPort?: number            // default 55155
  editorToken?: string       // default 'gemini-coder-vscode'
  browserToken?: string      // default 'gemini-coder'
  applyTimeoutMs?: number     // default 120000
}

export function loadConfig(dir: string): { config: CwcConfig | null; warning?: string } {
  const p = join(dir, '.cwc-mcp', 'config.json')
  if (!existsSync(p)) return { config: null }
  try { return { config: JSON.parse(readFileSync(p, 'utf-8')) } }
  catch (e) { return { config: null, warning: `config corrupt, using defaults: ${p}` } }  // surface, don't swallow
}
```

### Improvements over the original (apply the lessons)

- **Surface corruption** — return a warning instead of silently using defaults
  (gotcha #3); print it in `cwc-mcp-server doctor` (step 11).
- **gitignore from day one** — add `.cwc-mcp/` to `.gitignore` the moment you
  create the dir, even before you store secrets.
- **Windows perms (gotcha #1)** — if you store a token, don't rely on `0o600`
  alone on Windows; document the limitation and prefer an OS keychain or env var
  if you go cross-platform. Your V0 is local stdio with static tokens you don't
  own, so this is mostly moot until HTTP (step 10).

## Checklist

- [ ] One JSON config; defaults baked in code.
- [ ] Corruption surfaced as a warning, not swallowed.
- [ ] `.cwc-mcp/` gitignored immediately.
- [ ] Note Windows `0o600` caveat if you ever persist a secret.
