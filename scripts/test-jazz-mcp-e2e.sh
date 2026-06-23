#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${CWC_NO_NIX:-0}" != "1" && -z "${IN_NIX_SHELL:-}" ]]; then
  exec nix develop --quiet -c env CWC_NO_NIX=1 "$0" "$@"
fi

PORT="${JAZZ_PORT:-1625}"
ADMIN_SECRET="${JAZZ_ADMIN_SECRET:-cwc-rt-admin}"
SERVER_URL="ws://localhost:${PORT}"
DEPLOY_URL="http://localhost:${PORT}"
APP_ID_FILE=".jazz/app-id"
LOG="${JAZZ_E2E_LOG:-$(mktemp "${TMPDIR:-/tmp}/cwc-jazz-e2e-server.XXXXXX.log")}"

mkdir -p .jazz

if [[ ! -s "$APP_ID_FILE" ]]; then
  node -e "console.log(require('node:crypto').randomUUID())" > "$APP_ID_FILE"
fi

APP_ID="$(cat "$APP_ID_FILE")"
DATA_DIR="${JAZZ_E2E_DATA_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/cwc-jazz-e2e-data.XXXXXX")}"
CREATED_DATA_DIR=0

if [[ -z "${JAZZ_E2E_DATA_DIR:-}" ]]; then
  CREATED_DATA_DIR=1
fi

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi

  if [[ "$CREATED_DATA_DIR" == "1" ]]; then
    rm -rf "$DATA_DIR"
  fi
}
trap cleanup EXIT

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${PORT} is already in use. Stop the existing Jazz server or set JAZZ_PORT." >&2
  exit 1
fi

echo "==> build mcp-server + shared"
pnpm --filter cwc-mcp-server build

echo "==> start standalone Jazz server"
JAZZ_PORT="$PORT" \
JAZZ_APP_ID="$APP_ID" \
JAZZ_ADMIN_SECRET="$ADMIN_SECRET" \
JAZZ_DATA_DIR="$DATA_DIR" \
CWC_NO_NIX=1 \
scripts/jazz-server.sh >"$LOG" 2>&1 &

SERVER_PID=$!

for _ in {1..30}; do
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi

  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo "Jazz server exited early:" >&2
    cat "$LOG" >&2
    exit 1
  fi

  sleep 1
done

if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Jazz server did not listen on port ${PORT}:" >&2
  cat "$LOG" >&2
  exit 1
fi

sed -n '1,80p' "$LOG"

echo "==> deploy schema + permissions"
npx jazz-tools@alpha deploy "$APP_ID" \
  --schema-dir packages/shared/src/jazz \
  --server-url "$DEPLOY_URL" \
  --admin-secret "$ADMIN_SECRET"

echo "==> run MCP Jazz E2E with fake browser peer"

CWC_REPO_ROOT="$ROOT" \
JAZZ_APP_ID="$APP_ID" \
JAZZ_SERVER_URL="$SERVER_URL" \
JAZZ_ADMIN_SECRET="$ADMIN_SECRET" \
JAZZ_EXTERNAL_SERVER=1 \
pnpm --filter cwc-mcp-server exec node --input-type=module <<'EOF'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Buffer } from 'node:buffer'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createDb } from 'jazz-tools'

const root = process.env.CWC_REPO_ROOT
const appId = process.env.JAZZ_APP_ID
const serverUrl = process.env.JAZZ_SERVER_URL
const adminSecret = process.env.JAZZ_ADMIN_SECRET

assert.ok(root, 'CWC_REPO_ROOT is required')
assert.ok(appId, 'JAZZ_APP_ID is required')
assert.ok(serverUrl, 'JAZZ_SERVER_URL is required')
assert.ok(adminSecret, 'JAZZ_ADMIN_SECRET is required')

const schema = await import(
  pathToFileURL(join(root, 'packages/shared/dist/jazz/schema.js')).href
)

const permissionsModule = await import(
  pathToFileURL(join(root, 'packages/shared/dist/jazz/permissions.js')).href
)

const permissions = permissionsModule.default ?? permissionsModule.permissions

const fakeBrowserSecret = Buffer.alloc(32, 17).toString('base64url')

const fakeBrowserDb = await createDb({
  appId,
  app: schema.app,
  permissions,
  serverUrl,
  driver: { type: 'memory' },
  secret: fakeBrowserSecret
})

const expectedReply = 'hello from fake browser extension over Jazz'
const handled = new Set()

const unsubscribe = fakeBrowserDb.subscribeAll(
  schema.app.chat_requests.where({ status: 'pending' }),
  async (deltaLike) => {
    const changes = Array.isArray(deltaLike)
      ? deltaLike
      : deltaLike?.delta ?? []

    for (const change of changes) {
      const req = change.item

      if (!req?.request_id || handled.has(req.request_id)) {
        continue
      }

      handled.add(req.request_id)

      setImmediate(async () => {
        try {
          const inserted = await fakeBrowserDb.insert(schema.app.chat_responses, {
            request_id: req.request_id,
            response_text: expectedReply,
            status: 'done',
            error: undefined,
            created_at: Date.now()
          })

          await inserted?.wait?.({ tier: 'edge' })
        } catch (err) {
          console.error('Failed to insert response:', err)
        }
      })
    }
  }
)

// Let the fake browser subscription settle before the MCP server sends a row.
await new Promise((resolve) => setTimeout(resolve, 500))

const transport = new StdioClientTransport({
  command: 'bash',
  args: [join(root, 'scripts/run-jazz-external.sh')],
  env: {
    ...process.env,
    CWC_NO_NIX: '1',
    JAZZ_EXTERNAL_SERVER: '1',
    JAZZ_APP_ID: appId,
    JAZZ_SERVER_URL: serverUrl,
    JAZZ_ADMIN_SECRET: adminSecret
  }
})

const client = new Client({
  name: 'cwc-jazz-e2e',
  version: '0.0.0'
})

try {
  await client.connect(transport)

  const tools = await client.listTools()
  const toolNames = tools.tools.map((tool) => tool.name)

  assert.ok(toolNames.includes('cwc_status'), 'cwc_status tool missing')
  assert.ok(
    toolNames.includes('send_to_codewebchat'),
    'send_to_codewebchat tool missing'
  )
  assert.ok(
    toolNames.includes('poll_cwc_response'),
    'poll_cwc_response tool missing'
  )

  const status = await client.callTool({
    name: 'cwc_status',
    arguments: {}
  })

  const statusPayload = JSON.parse(status.content[0].text)
  assert.equal(statusPayload.mode, 'host')
  assert.equal(statusPayload.websocket_connected, true)

  const send = await client.callTool({
    name: 'send_to_codewebchat',
    arguments: {
      url: 'https://chatgpt.com/',
      text: 'E2E test prompt',
      prompt_type: 'edit-context',
      timeout_ms: 30000
    }
  })

  const sendPayload = JSON.parse(send.content[0].text)
  assert.equal(sendPayload.status, 'pending')
  assert.ok(sendPayload.ticket, 'send_to_codewebchat did not return a ticket')

  let finalPayload = null

  for (let i = 0; i < 30; i++) {
    const poll = await client.callTool({
      name: 'poll_cwc_response',
      arguments: {
        ticket: sendPayload.ticket,
        wait_ms: 1000
      }
    })

    const payload = JSON.parse(poll.content[0].text)

    if (payload.status === 'done') {
      finalPayload = payload
      break
    }
  }

  assert.ok(finalPayload, 'poll_cwc_response never returned done')
  assert.equal(finalPayload.response, expectedReply)

  console.log('Jazz MCP E2E passed:', finalPayload.response)
} finally {
  await client.close().catch(() => undefined)
  unsubscribe?.()
  await fakeBrowserDb.shutdown?.()
}
EOF

echo "==> Jazz MCP E2E passed"
