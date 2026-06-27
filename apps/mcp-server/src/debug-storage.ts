import { WebSocket } from 'ws'

const extId = 'hmfdmaimnhaeafbfgmojefnokmdpogen'

async function main() {
  const targets = await fetch('http://127.0.0.1:9222/json/list').then((r) =>
    r.json()
  )
  const sw = targets.find(
    (t: any) => t.type === 'service_worker' && t.url.includes(extId)
  )

  if (!sw) {
    console.error('Service worker not found')
    process.exit(1)
  }

  const ws = new WebSocket(sw.webSocketDebuggerUrl)

  await new Promise((resolve) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
      ws.send(
        JSON.stringify({
          id: 2,
          method: 'Runtime.evaluate',
          params: {
            expression: `chrome.storage.local.get(null)`,
            awaitPromise: true,
            returnByValue: true
          }
        })
      )
    })

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id === 2) {
        console.log(
          'chrome.storage.local contents:',
          JSON.stringify(msg.result?.result?.value, null, 2)
        )
        ws.close()
        resolve(undefined)
      }
    })
  })
}

main().catch(console.error)
