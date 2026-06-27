import { WebSocket } from 'ws'

const extId = 'hmfdmaimnhaeafbfgmojefnokmdpogen'

async function main() {
  const targets = await fetch('http://127.0.0.1:9222/json/list').then((r) =>
    r.json()
  )
  const offscreen = targets.find(
    (t: any) => t.url.includes('offscreen') && t.url.includes(extId)
  )

  if (!offscreen) {
    console.error('Offscreen document not found')
    process.exit(1)
  }

  console.log(
    'Connecting to offscreen debugger URL:',
    offscreen.webSocketDebuggerUrl
  )
  const ws = new WebSocket(offscreen.webSocketDebuggerUrl)

  const logs: string[] = []

  await new Promise((resolve) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
      ws.send(JSON.stringify({ id: 2, method: 'Console.enable' }))
      ws.send(JSON.stringify({ id: 3, method: 'Log.enable' }))

      ws.send(
        JSON.stringify({
          id: 10,
          method: 'Runtime.evaluate',
          params: {
            expression: `(async () => {
            try {
              const res = await chrome.storage.local.get(null);
              return { res };
            } catch (e) {
              return { error: e.message };
            }
          })()`,
            awaitPromise: true,
            returnByValue: true
          }
        })
      )
    })

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())

      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args
          .map((a: any) => a.value ?? a.description ?? JSON.stringify(a))
          .join(' ')
        logs.push(`[${msg.params.type}] ${text}`)
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        logs.push(
          `[EXCEPTION] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`
        )
      }
      if (msg.method === 'Log.entryAdded') {
        logs.push(`[LOG] ${msg.params.entry.text}`)
      }

      if (msg.id === 10) {
        console.log(
          'Storage inside offscreen evaluation:',
          JSON.stringify(msg.result?.result?.value, null, 2)
        )
        setTimeout(() => {
          console.log('Captured logs:')
          for (const l of logs) {
            console.log('  ', l)
          }
          ws.close()
          resolve(undefined)
        }, 1500)
      }
    })
  })
}

main().catch(console.error)
