import { WebSocket } from 'ws'

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

  const appId = 'e06170f2-5bf5-421d-ae69-997e6a3c0bb7'
  console.log(`Setting settings for app ID: ${appId}`)

  const ws = new WebSocket(extensionTarget.webSocketDebuggerUrl)

  ws.on('open', () => {
    // Enable runtime to execute expressions
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable', params: {} }))

    // Set configuration
    const expr = `
      chrome.storage.local.set({
        cwc_jazz_enabled: true,
        cwc_jazz_app_id: '${appId}',
        cwc_jazz_server_url: 'ws://localhost:1625'
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
