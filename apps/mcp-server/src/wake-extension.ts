import { WebSocket } from 'ws'

async function main() {
  const listUrl = 'http://127.0.0.1:9222/json/list'
  console.log(`Connecting to Chrome: ${listUrl}`)

  let targets
  try {
    const res = await fetch(listUrl)
    targets = (await res.json()) as any[]
  } catch (err) {
    console.error('Failed to connect to Chrome.', err)
    process.exit(1)
  }

  const pageTarget = targets.find((t) => t.type === 'page')

  if (!pageTarget) {
    console.error('No open tab found in Chrome.')
    process.exit(1)
  }

  console.log(`Navigating tab ${pageTarget.id} to popup...`)
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)

  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Page.navigate',
        params: {
          url: 'https://chatgpt.com/'
        }
      })
    )
  })

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.id === 1) {
      console.log('Navigation command sent:', msg.result)
      setTimeout(() => {
        ws.close()
        console.log('Tab navigated.')
      }, 1000)
    }
  })
}

main().catch(console.error)
