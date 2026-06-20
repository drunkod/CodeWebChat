# cwc-mcp-server

Local stdio MCP server that lets MCP clients send prompts through the CodeWebChat browser extension.

## Build the server

From the repository root:

```bash
nix develop path:/Users/test/Documents/work/CodeWebChat --command pnpm install
nix develop path:/Users/test/Documents/work/CodeWebChat --command pnpm --filter cwc-mcp-server build
```

Verify the output exists:

```bash
ls apps/mcp-server/dist/index.js
```

## Claude Desktop config example

### macOS/Linux — `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "codewebchat": {
      "command": "node",
      "args": [
        "/Users/test/Documents/work/CodeWebChat/apps/mcp-server/dist/index.js"
      ]
    }
  }
}
```

### Windows — `%APPDATA%\\Claude\\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "codewebchat": {
      "command": "node",
      "args": [
        "C:\\Users\\YOUR_NAME\\CodeWebChat\\apps\\mcp-server\\dist\\index.js"
      ]
    }
  }
}
```

## Cursor-style `.cursor/mcp.json` example

```json
{
  "mcpServers": {
    "codewebchat": {
      "command": "node",
      "args": [
        "/Users/test/Documents/work/CodeWebChat/apps/mcp-server/dist/index.js"
      ]
    }
  }
}
```

## Inspector test command

```bash
npx @modelcontextprotocol/inspector node apps/mcp-server/dist/index.js
```

## Manual demo prompt for the MCP client

```text
Use the codewebchat MCP server.
First call cwc_status.
Then call send_to_codewebchat with url https://claude.ai/new and this prompt:

"Write a tiny TypeScript function named summarizeBridgeStatus that accepts an object with websocket_connected, client_id, browser_connected, and connected_browser_count. Return a human-readable one-line status string. Include only the code block."

After the browser chatbot responds, I will click Apply Response.
Return the text that the MCP tool receives.
```

## Expected `cwc_status` output

```json
{
  "websocket_connected": true,
  "client_id": 1,
  "browser_connected": true,
  "connected_browser_count": 1
}
```

## Failure cases to verify manually

### No CodeWebChat WebSocket server

Expected error:

```text
Could not connect to CodeWebChat at ws://localhost:55155. Start the CodeWebChat WebSocket server first. (connect ECONNREFUSED 127.0.0.1:55155)
```

### No browser extension connected

Expected error:

```text
No CodeWebChat browser extension is connected. Open the browser extension before using this MCP tool.
```

### VS Code extension restarts while waiting for Apply Response

Expected error:

```text
CodeWebChat WebSocket closed while waiting for Apply Response. The VS Code extension may have restarted. Retry the tool call.
```

### User never clicks Apply Response

Expected error after timeout:

```text
Timed out after 300000ms waiting for Apply Response. The user must click Apply Response in the chatbot tab.
```

### Clipboard unchanged

Expected error:

```text
Apply Response completed, but the clipboard did not change. Refusing to return stale clipboard content.
```

## A.4 demo checklist

```text
[ ] CodeWebChat VS Code extension or WebSocket server is running.
[ ] CodeWebChat browser extension is connected.
[ ] pnpm install ran from the repo root.
[ ] MCP server builds successfully: pnpm --filter cwc-mcp-server build
[ ] apps/mcp-server/dist/index.js exists.
[ ] MCP client can call cwc_status.
[ ] send_to_codewebchat opens the selected chatbot.
[ ] User clicks Apply Response after generation finishes.
[ ] MCP client receives raw response text.
[ ] Stopping VS Code mid-request returns CWC_DISCONNECTED immediately.
```
