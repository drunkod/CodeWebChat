# Step 10 — Transports (stdio → HTTP) and auth (V1+)

**Source:** `draft/src/cli/mcp/transports/stdio.ts` (8 lines),
`draft/src/cli/mcp/transports/http.ts:274-372` (~370 lines),
`draft/src/cli/mcp/oauth.ts`, `draft/src/cli/mcp/auth.ts`.

## Developer's answer (the cost of HTTP)

> "stdio is 8 lines; HTTP is ~370. HTTP adds session management, OAuth 2.0 PKCE,
> passphrase-backed `/authorize`, dynamic client registration,
> `/.well-known/` discovery, bearer fallback, `trust proxy`, graceful shutdown,
> `/health`."
>
> "HTTP was required from day one **because ChatGPT Web cannot reach
> `127.0.0.1`**. The real cost was discovering ChatGPT's connector auth is
> **OAuth only** (not static bearer). If you're stdio-only and your client is
> local, **stay stdio**. The HTTP complexity is entirely driven by ChatGPT's
> remote OAuth requirement."

Your V0 is local stdio — **correct, keep it.** Only add HTTP if you need a
remote client.

## Keep the transport split (cheap future-proofing)

The whole stdio transport:

```ts
// draft/src/cli/mcp/transports/stdio.ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createRepoHarnessMcpServer } from '../server'

export async function startMcpStdio(opts) {
  const server = createRepoHarnessMcpServer(opts)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
```

Mirror this: keep `createCwcMcpServer(deps)` as a factory, and put transports in
`transports/stdio.ts` (now) and `transports/http.ts` (later). Adding HTTP then
becomes a new file, not a rewrite — exactly how repo-harness is structured.

## If/when you add HTTP

The repo's HTTP file is the reference for: bearer compare with
`timingSafeEqual` (constant-time, anti-timing-attack), OAuth PKCE with a
JSON-backed token store that survives restarts and tolerates corruption,
`/.well-known/oauth-protected-resource` discovery, `/health`, and graceful
shutdown flushing the token store. Copy its shape; pin the SDK version (step 12)
because the auth handler imports are deep subpaths that move between releases:

```ts
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
```

> The developer's lesson on auth: **run the connect E2E before finalizing auth.**
> They assumed static bearer and discovered ChatGPT required OAuth only during a
> manual end-to-end test. If you ever expose `cwc-mcp-server` to a remote client,
> verify its auth model first.

## Checklist

- [ ] Stay stdio for V0.
- [ ] Keep a server factory + `transports/` split so HTTP is additive.
- [ ] If HTTP: `timingSafeEqual` for bearer, pin SDK version, E2E the client's
      real auth model before committing to a design.
