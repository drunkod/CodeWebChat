# Step 4 — Add MCP Client Config and Manual Demo

## Goal

Document exactly how to run the prototype from an MCP client and prove the end-to-end semi-automated path.

The demo should not promise full automation. The success condition is:

```text
send prompt -> browser chatbot opens -> user clicks Apply Response -> MCP tool returns clipboard text
```

## Build the server

From the repository root:

```bash
cd apps/mcp-server
npm install
npm run build
```

## Claude Desktop config example

Replace `/absolute/path/to/CodeWebChat` with your local repository path.

### macOS/Linux config body

```json
{
  "mcpServers": {
    "codewebchat": {
      "command": "node",
      "args": [
        "/absolute/path/to/CodeWebChat/apps/mcp-server/dist/index.js"
      ]
    }
  }
}
```

### Windows config body

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
        "/absolute/path/to/CodeWebChat/apps/mcp-server/dist/index.js"
      ]
    }
  }
}
```

## Inspector test command

From the repository root:

```bash
npx @modelcontextprotocol/inspector node apps/mcp-server/dist/index.js
```

## Manual demo prompt for the MCP client

Ask the MCP client:

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

## Expected chatbot response example

The exact model output may differ, but the MCP server should return raw clipboard text similar to:

```ts
export type BridgeStatus = {
  websocket_connected: boolean
  client_id: number | null
  browser_connected: boolean
  connected_browser_count: number
}

export function summarizeBridgeStatus(status: BridgeStatus): string {
  const websocket = status.websocket_connected ? 'WebSocket connected' : 'WebSocket disconnected'
  const browser = status.browser_connected
    ? `${status.connected_browser_count} browser${status.connected_browser_count === 1 ? '' : 's'} connected`
    : 'no browser connected'
  const client = status.client_id === null ? 'no client id' : `client id ${status.client_id}`

  return `${websocket}; ${browser}; ${client}.`
}
```

## Failure cases to verify manually

### No CodeWebChat WebSocket server

Expected error:

```text
Timed out connecting to CodeWebChat at ws://localhost:55155. Start the CodeWebChat WebSocket server first.
```

### No browser extension connected

Expected error:

```text
No CodeWebChat browser extension is connected. Open the browser extension before using this MCP tool.
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

## Demo checklist

```text
[ ] CodeWebChat VS Code extension or WebSocket server is running.
[ ] CodeWebChat browser extension is connected.
[ ] MCP server builds successfully.
[ ] MCP client can call cwc_status.
[ ] send_to_codewebchat opens the selected chatbot.
[ ] User clicks Apply Response after generation finishes.
[ ] MCP client receives raw response text.
```
