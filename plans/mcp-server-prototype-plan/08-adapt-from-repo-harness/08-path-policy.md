# Step 8 — Path policy: deny globs + traversal + symlink + size cap (V1, only if you add file tools)

**Source:** `draft/src/cli/mcp/paths.ts` and `draft/src/cli/mcp/policy.ts`.

Only relevant **if** `cwc-mcp-server` ever exposes file read/write tools. A pure
prompt bridge does not need this. If you add file tools, copy this module
wholesale — it is tested against real attacks.

## Developer's answer (what it actually caught)

> "Unit tests document what it catches: `../outside` traversal, absolute paths
> (`/etc/passwd`), symlink escape (via `realpathSync`), deny-glob matches
> (`.env`, `.git/**`, `node_modules/**`), files above `maxFileBytes` (512 KB),
> and binary files (null-byte scan). The E2E confirmed denied `.env` reads,
> traversal rejection, symlink escape rejection."
>
> Subtlety: "`denyGlobMatches` is more aggressive than allow matching — a deny
> pattern without `/` is matched against **every path segment**, so `.env`
> blocks `subdir/.env` too."

## Source: the layered check

```ts
// paths.ts — normalize first
export function normalizeMcpRelativePath(input: string): McpPathDecision {
  const trimmed = input.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'path is required' }
  if (isAbsolute(trimmed)) return { ok: false, reason: 'absolute paths are not allowed' }
  const normalized = toPosixPath(trimmed).replace(/^\.\/+/, '')
  if (normalized === '' || normalized === '.') return { ok: false, reason: 'path must target a file' }
  if (normalized.split('/').some((part) => part === '..'))
    return { ok: false, reason: 'path traversal is not allowed' }
  return { ok: true, relativePath: normalized }
}

// resolveMcpPath — deny globs, then realpath confinement, then symlink target check
if (anyDenyGlobMatches(policy.denyGlobs, relativePath))
  return { ok: false, relativePath, reason: `path is denied by MCP policy: ${relativePath}` }
const realExistingPath = realpathSync(existingPath)
if (!realpathInside(realExistingPath, repoRealpath))
  return { ok: false, relativePath, reason: `path escapes repository root: ${relativePath}` }
if (existsSync(absolutePath) && lstatSync(absolutePath).isSymbolicLink()) {
  const realTarget = realpathSync(absolutePath)
  if (!realpathInside(realTarget, repoRealpath))
    return { ok: false, relativePath, reason: `symlink escapes repository root: ${relativePath}` }
}
```

The deny list (`policy.ts:3-21`): `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`,
`*.pfx`, `.ssh/**`, `.git/**`, `node_modules/**`, `dist/**`, `secrets/**`,
`credentials/**`, `private/**`, `.DS_Store`. Size cap `512 * 1024`. Binary
guard: null byte in first 8000 bytes (`tools.ts:51-53`).

## Order of checks (copy this exact order)

1. Normalize → reject empty / absolute / `..`.
2. Deny globs (block before any allow consideration).
3. Allow globs (must match a read/write allowlist).
4. `realpathSync` confinement to root (defeats symlink escape).
5. Size cap + binary scan at read time.

## Adapt to `cwc-mcp-server`

If you add e.g. a `read_project_file` tool to give the chatbot context, wrap
every path through a `resolvePath(root, input, 'read')` port before touching the
filesystem, reusing the order above. Don't roll your own glob silently — port
their `globMatches` and unit-test it (step 5).

## Checklist

- [ ] Only build this if a file tool actually ships.
- [ ] Keep the 5-step order; deny before allow.
- [ ] `realpathSync` confinement, not just string prefix checks.
- [ ] Unit tests for traversal, absolute, symlink escape, deny hit, oversize.
