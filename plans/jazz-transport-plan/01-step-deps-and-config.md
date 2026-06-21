# Step 1 — Dependencies & config

Add Jazz, an app id / port, and the `--transport` plumbing. No behavior change yet
(default stays `ws`).

## 1.1 Add the dependency (MCP server package)

`apps/mcp-server/package.json` — add `jazz-tools` (pin the alpha you test against):

```jsonc
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.17.0",
    "clipboardy": "^4.0.0",
    "ws": "^8.18.0",
    "zod": "^3.25.0",
    "jazz-tools": "0.0.0-alpha.XXX"   // pin the exact alpha; see notes
  }
}
```

Install from the repo root: `pnpm --filter cwc-mcp-server add jazz-tools@alpha`.

> `jazz-tools` ships a native addon (NAPI) for the Node backend and the embedded
> dev server. Confirm it installs in your Nix shell; if the prebuilt binary
> doesn't resolve, that's the first thing to debug (it blocks everything else).

## 1.2 New config module

`apps/mcp-server/src/jazz-config.ts`:

```ts
import { randomUUID } from 'node:crypto'

export type JazzConfig = {
  appId: string
  port: number
  dataDir: string
  serverUrl: string // ws://localhost:<port>
}

/**
 * Resolve Jazz config from env, with safe local defaults.
 * SECURITY: appId should be a non-guessable UUID (the sync server binds 0.0.0.0
 * and dev local-first auth accepts any token — a friendly name is world-readable).
 */
export function resolveJazzConfig(): JazzConfig {
  const port = Number(process.env.JAZZ_PORT ?? 1625)
  const appId = process.env.JAZZ_APP_ID ?? randomUUID()
  const dataDir = process.env.JAZZ_DATA_DIR ?? '.jazz/server'
  const serverUrl = process.env.JAZZ_SERVER_URL ?? `ws://localhost:${port}`
  return { appId, port, dataDir, serverUrl }
}
```

> For a real deployment you want a **stable** `appId` shared by both peers (env or
> a generated-and-persisted file), not a fresh UUID each boot — otherwise the two
> processes land in different namespaces. Step 7 reads the same `appId` in the
> extension. For local dev, persist it to `.jazz/app-id` on first run.

## 1.3 Transport-mode flag (parsing only)

The existing `index.ts` already parses `--mode host|client`. Add a parallel
`--transport jazz|ws` (default `ws`). Wiring happens in Step 5; here just define
the type and parser so other steps can import it.

`apps/mcp-server/src/transport-mode.ts`:

```ts
export type TransportKind = 'ws' | 'jazz'

export function parseTransportKind(argv: string[]): TransportKind {
  const i = argv.indexOf('--transport')
  const raw = (i >= 0 ? argv[i + 1] : process.env.CWC_TRANSPORT) ?? 'ws'
  if (raw !== 'ws' && raw !== 'jazz') {
    throw new Error(`invalid --transport "${raw}" (expected ws|jazz)`)
  }
  return raw
}
```

## 1.4 gitignore the local Jazz data

Append to `.gitignore`:

```
# Jazz local sync server state
.jazz/
```

## Done when

- `jazz-tools` installs and imports in the Nix build (`import 'jazz-tools'` compiles).
- `resolveJazzConfig()` and `parseTransportKind()` compile.
- `.jazz/` is gitignored.
- Default behavior unchanged (transport defaults to `ws`).
