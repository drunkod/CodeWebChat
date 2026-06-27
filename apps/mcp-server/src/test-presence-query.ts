import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createJazzContext } from 'jazz-tools/backend'
import { app } from '../../../packages/shared/dist/jazz/schema.js'
import permissions from '../../../packages/shared/dist/jazz/permissions.js'

const repoRoot = '/Users/test/Documents/work/CodeWebChat'

function resolveAppId(): string {
  return readFileSync(join(repoRoot, '.jazz/app-id'), 'utf8').trim()
}

async function main(): Promise<void> {
  const appId = resolveAppId()
  const serverUrl = 'ws://localhost:1625'
  const backendSecret = 'cwc-rt-backend'
  const adminSecret = 'cwc-rt-admin'

  console.log(`Connecting Node peer to check presence...`)
  const ctx = createJazzContext({
    appId,
    app,
    permissions,
    serverUrl,
    allowLocalFirstAuth: true,
    backendSecret,
    adminSecret,
    driver: { type: 'memory' }
  } as any)

  const db = ctx.asBackend()

  console.log('Subscribing to browser_presence table...')
  const items: any[] = []

  const maybeUnsub = db.subscribeAll(app.browser_presence, (deltaLike: any) => {
    const changes = Array.isArray(deltaLike)
      ? deltaLike
      : (deltaLike?.delta ?? [])
    for (const change of changes) {
      if (change?.item) {
        items.push(change.item)
      }
    }
  })

  await new Promise((resolve) => setTimeout(resolve, 3000))

  console.log(`Found ${items.length} presence records:`)
  console.log(JSON.stringify(items, null, 2))

  const unsub = await Promise.resolve(maybeUnsub)
  unsub?.()
  await ctx.shutdown?.()
  process.exit(0)
}

main().catch(console.error)
