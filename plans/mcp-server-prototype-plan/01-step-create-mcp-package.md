# Step 1 — Create the MCP Server Package

## Goal

Create a minimal local MCP server package that can be launched by an MCP client over stdio. This step creates the package skeleton only; later steps add the CodeWebChat WebSocket bridge, MCP tools, tests, and protocol upgrade path.

This plan is based on the research findings that:

- CodeWebChat uses a stable local WebSocket port: `localhost:55155`.
- Editor-role clients authenticate with the static token `gemini-coder-vscode`.
- Browser-role clients authenticate with the static token `gemini-coder`.
- `ApplyChatResponseMessage` does not contain response text today; the current prototype must read the OS clipboard after the user clicks **Apply Response**.
- `without_submission` is not currently part of `InitializeChatMessage`, so this MCP prototype must not rely on it.

## pnpm workspace

The repo root `pnpm-workspace.yaml` already includes `apps/*`:

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

`apps/mcp-server` is therefore automatically part of the workspace — no change needed. Install and build from the **repo root** using pnpm (see Step 4). Do **not** run `npm install` inside the package directory; that creates a conflicting `package-lock.json` and bypasses workspace hoisting.

## New folder

Create a new package at:

```text
apps/mcp-server/
```

## Complete file: `apps/mcp-server/package.json`

```json
{
  "name": "cwc-mcp-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Local stdio MCP server that lets MCP clients send prompts through the CodeWebChat browser extension.",
  "bin": {
    "cwc-mcp-server": "dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "test": "pnpm run build && node --test $(find dist -name '*.test.js' | sort)"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.17.0",
    "clipboardy": "^4.0.0",
    "ws": "^8.18.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "@types/ws": "^8.5.12",
    "tsx": "^4.19.4",
    "typescript": "^5.8.3"
  },
  "engines": {
    "node": ">=20"
  }
}
```

> **Note on test script:** Uses `find dist -name '*.test.js' | sort` instead of a shell glob (`dist/**/*.test.js`). Glob expansion of `**` is inconsistent across bash, zsh, and CI environments. `find` is portable on macOS, Linux, and Windows (Git Bash / WSL).

## Complete file: `apps/mcp-server/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

## Complete file: `apps/mcp-server/src/protocol.ts`

```ts
export const DEFAULT_CWC_PORT = 55155

export const SECURITY_TOKENS = {
  BROWSERS: 'gemini-coder',
  VSCODE: 'gemini-coder-vscode'
} as const

export type WebPromptType = string

export type InitializeChatMessage = {
  action: 'initialize-chat'
  text: string
  url: string
  client_id: number
  model?: string
  target_browser_id?: number
  temperature?: number
  thinking_budget?: number
  reasoning_effort?: string
  top_p?: number
  system_instructions?: string
  options?: string[]
  raw_instructions?: string
  edit_format?: string
  prompt_type?: WebPromptType
  reuse_last_tab?: boolean
  invocation_count?: number
}

export type ApplyChatResponseMessage = {
  action: 'apply-chat-response'
  client_id: number
  raw_instructions?: string
  edit_format?: string
  url?: string
}

export type ClientIdAssignmentMessage = {
  action: 'client-id-assignment'
  client_id: number
}

export type BrowserConnectionStatusMessage = {
  action: 'browser-connection-status'
  has_connected_browsers: boolean
  connected_browsers?: Array<{
    id: number
    name?: string
  }>
}

export type CwcInboundMessage =
  | ApplyChatResponseMessage
  | ClientIdAssignmentMessage
  | BrowserConnectionStatusMessage
  | Record<string, unknown>
```

## Complete file: `apps/mcp-server/src/errors.ts`

```ts
export class CwcMcpError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'CWC_NOT_CONNECTED'
      | 'CWC_NO_CLIENT_ID'
      | 'CWC_NO_BROWSER'
      | 'CWC_TIMEOUT'
      | 'CWC_CLIPBOARD_EMPTY'
      | 'CWC_CLIPBOARD_UNCHANGED'
      | 'CWC_BAD_MESSAGE'
      | 'CWC_DISCONNECTED'
  ) {
    super(message)
    this.name = 'CwcMcpError'
  }
}

export const toErrorText = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
```

> **Note:** `CWC_DISCONNECTED` is added to the error code union. Step 2 uses it when the WebSocket closes while a prompt is in-flight, so the MCP client receives an immediate error instead of hanging until `timeout_ms`.

## Complete file: `apps/mcp-server/src/clipboard.ts`

```ts
import clipboard from 'clipboardy'

export type ReadClipboard = () => Promise<string>

export const readSystemClipboard: ReadClipboard = async () => {
  try {
    return await clipboard.read()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not read the OS clipboard. On Linux, install xclip, xsel, or wl-clipboard as needed. Original error: ${message}`
    )
  }
}
```

## Install and build

From the **repository root** (not inside `apps/mcp-server`):

```bash
# Install all workspace dependencies including the new package
pnpm install

# Build only the MCP server package
pnpm --filter cwc-mcp-server build

# Or build all workspace packages at once
pnpm -r build
```
