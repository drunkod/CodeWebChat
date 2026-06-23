import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

function readAppId(): string {
  const appId = process.env.JAZZ_APP_ID?.trim()
  if (appId) return appId

  try {
    return readFileSync(join(repoRoot, '.jazz/app-id'), 'utf8').trim()
  } catch {
    throw new Error(
      'No Jazz app id found. Set JAZZ_APP_ID or run scripts/jazz-server.sh to create .jazz/app-id.'
    )
  }
}

async function main() {
  const listUrl = 'http://127.0.0.1:9222/json/list'
  console.log(`Connecting to Chrome: ${listUrl}`)

  let targets
  try {
    const res = await fetch(listUrl)
    targets = (await res.json()) as any[]
  } catch (err) {
    console.error(
      'Failed to connect to Chrome. Is it running on port 9222?',
      err
    )
    process.exit(1)
  }

  const extensionTarget = targets.find(
    (t) =>
      t.type === 'service_worker' &&
      t.url.includes('chrome-extension://') &&
      t.url.includes('background.js')
  )

  if (!extensionTarget) {
    console.error('Extension service worker target not found.')
    process.exit(1)
  }

  const appId = readAppId()
  const serverUrl = process.env.JAZZ_SERVER_URL ?? 'ws://localhost:1625'
  console.log(`Setting Jazz settings: appId=${appId}, serverUrl=${serverUrl}`)

  const ws = new WebSocket(extensionTarget.webSocketDebuggerUrl)

  ws.on('open', () => {
    // Enable runtime to execute expressions
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable', params: {} }))

    // Set configuration
    const expr = `
      chrome.storage.local.set({
        cwc_jazz_enabled: true,
        cwc_jazz_app_id: ${JSON.stringify(appId)},
        cwc_jazz_server_url: ${JSON.stringify(serverUrl)}
      }).then(() => {
        console.log('Jazz configured! Reloading extension...');
        chrome.runtime.reload();
      });
    `

    ws.send(
      JSON.stringify({
        id: 2,
        method: 'Runtime.evaluate',
        params: { expression: expr }
      })
    )
  })

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.id === 2) {
      console.log('Expression evaluated:', msg.result)
      setTimeout(() => {
        ws.close()
        console.log('Settings applied.')
      }, 1000)
    }
  })
}

main().catch(console.error)
