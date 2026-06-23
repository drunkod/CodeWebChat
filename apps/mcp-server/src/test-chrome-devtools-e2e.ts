import { WebSocket } from 'ws'

async function main() {
  const listUrl = 'http://127.0.0.1:9222/json/list'
  console.log(`Connecting to Chrome DevTools list: ${listUrl}`)

  let targets
  try {
    const res = await fetch(listUrl)
    targets = (await res.json()) as any[]
  } catch (err) {
    console.error(
      'Failed to connect to Chrome on port 9222. Is Chrome running with --remote-debugging-port=9222?',
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
    console.error(
      'Could not find the extension service worker target. Is the CodeWebChat extension loaded?',
      targets
    )
    process.exit(1)
  }

  console.log(`Found extension service worker: ${extensionTarget.title}`)
  console.log(`CDP WebSocket URL: ${extensionTarget.webSocketDebuggerUrl}`)

  const ws = new WebSocket(extensionTarget.webSocketDebuggerUrl)

  ws.on('open', () => {
    console.log('Connected to Extension Service Worker CDP WebSocket!')

    // Enable console log capture
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.enable',
        params: {}
      })
    )

    // Query storage state
    ws.send(
      JSON.stringify({
        id: 2,
        method: 'Runtime.evaluate',
        params: {
          expression: `chrome.storage.local.get(null).then(data => JSON.stringify(data))`
        }
      })
    )
  })

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())

    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = msg.params.args
        .map((a: any) => a.value ?? a.description)
        .join(' ')
      console.log(`[Extension Log] ${args}`)
    } else if (msg.id === 2) {
      const result = msg.result?.result?.value
      console.log(`[Extension LocalStorage]: ${result}`)

      // Close the connection after getting the state
      setTimeout(() => {
        ws.close()
        console.log('Done.')
      }, 1000)
    }
  })

  ws.on('error', (err) => {
    console.error('WebSocket Error:', err)
  })
}

main().catch(console.error)
