// Live Jazz roundtrip driver: inserts a real chat_requests row into the running
// standalone Jazz sync server and waits for the REAL Chrome extension (memory
// client) to pick it up, drive the chatbot, and write back a chat_responses row.
//
// Prereqs:
//   1. scripts/jazz-server.sh running (standalone server on :1625)
//   2. schema deployed: npx jazz-tools@alpha deploy "$(cat .jazz/app-id)" ...
//   3. Chrome with the extension loaded + Jazz enabled (same app id + ws://localhost:1625)
//
// Run:  nix develop -c pnpm --filter cwc-mcp-server exec tsx src/live-test-sync.ts
// (the dist .js imports below also let it run after a build)
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createJazzContext } from 'jazz-tools/backend'
// Import the BUILT schema/permissions (no .ts extension) so this compiles under
// the normal tsc build as well as tsx. Run `pnpm --filter shared build` first.
import { app } from '../../../packages/shared/dist/jazz/schema.js'
import permissions from '../../../packages/shared/dist/jazz/permissions.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

function resolveAppId(): string {
  if (process.env.JAZZ_APP_ID) return process.env.JAZZ_APP_ID
  try {
    return readFileSync(join(repoRoot, '.jazz/app-id'), 'utf8').trim()
  } catch {
    throw new Error(
      'No app id: set JAZZ_APP_ID or create .jazz/app-id (run scripts/jazz-server.sh first).'
    )
  }
}

async function main(): Promise<void> {
  const appId = resolveAppId()
  const serverUrl = process.env.JAZZ_SERVER_URL ?? 'ws://localhost:1625'
  const backendSecret = process.env.JAZZ_BACKEND_SECRET ?? 'cwc-rt-backend'
  const adminSecret = process.env.JAZZ_ADMIN_SECRET ?? 'cwc-rt-admin'
  const timeoutMs = Number(process.env.CWC_LIVE_TIMEOUT_MS ?? 30000)

  console.log(`Connecting Node peer to ${serverUrl} (appId=${appId})...`)
  const ctx = createJazzContext({
    appId,
    app,
    permissions,
    serverUrl,
    allowLocalFirstAuth: true,
    backendSecret,
    adminSecret,
    driver: { type: 'memory' }
  } as Parameters<typeof createJazzContext>[0])

  const db = ctx.asBackend()
  const requestId = randomUUID()
  let unsub: (() => void) | undefined

  const waitForResponse = new Promise<string>((resolve) => {
    const maybeUnsub = db.subscribeAll(
      app.chat_responses,
      (deltaLike: unknown) => {
        const changes = Array.isArray(deltaLike)
          ? deltaLike
          : ((deltaLike as { delta?: unknown[] })?.delta ?? [])
        for (const change of changes as Array<{ item?: any }>) {
          const row = change?.item
          if (row && row.request_id === requestId) {
            console.log('Received response from the Chrome extension!')
            resolve(row.response_text)
          }
        }
      },
      { tier: 'edge' }
    )
    void Promise.resolve(maybeUnsub).then((u) => {
      unsub = u as () => void
    })
  })

  console.log(`Inserting request ${requestId} into chat_requests...`)
  await db
    .insert(app.chat_requests, {
      request_id: requestId,
      url: 'https://chatgpt.com/',
      text: 'Live synced query from Node peer',
      prompt_type: 'edit-context',
      status: 'pending',
      created_at: Date.now()
    })
    .wait({ tier: 'edge' })

  console.log(
    `Request inserted, waiting up to ${timeoutMs}ms for the extension to respond...`
  )
  try {
    const responseText = await Promise.race([
      waitForResponse,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`Timeout waiting for response after ${timeoutMs}ms`)
            ),
          timeoutMs
        )
      )
    ])
    console.log('SUCCESS. Response text:', responseText)
  } finally {
    unsub?.()
    await ctx.shutdown?.()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
