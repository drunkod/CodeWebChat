import { WebSocket } from 'ws'

async function main() {
  const listUrl = 'http://127.0.0.1:9222/json/list'
  console.log(`Connecting to Chrome DevTools list: ${listUrl}`)

  let targets
  try {
    const res = await fetch(listUrl)
    targets = (await res.json()) as any[]
  } catch (err) {
    console.error('Failed to connect to Chrome.', err)
    process.exit(1)
  }

  // Find the popup page target
  const popupTarget = targets.find(
    (t) =>
      t.type === 'page' &&
      t.url.includes('chrome-extension://') &&
      t.url.includes('popup.html')
  )

  if (!popupTarget) {
    console.error('Could not find the extension popup page target.')
    process.exit(1)
  }

  console.log(`Found extension popup target: ${popupTarget.title}`)
  console.log(`CDP WebSocket URL: ${popupTarget.webSocketDebuggerUrl}`)

  const ws = new WebSocket(popupTarget.webSocketDebuggerUrl)

  ws.on('open', () => {
    console.log('Connected to Extension Popup CDP WebSocket!')

    // Enable console log capture
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable', params: {} }))
    ws.send(JSON.stringify({ id: 2, method: 'Log.enable', params: {} }))

    // Evaluate lastError or background connection status
    ws.send(
      JSON.stringify({
        id: 3,
        method: 'Runtime.evaluate',
        params: {
          expression: `
          Promise.all([
            chrome.runtime.getBackgroundPage ? chrome.runtime.getBackgroundPage() : Promise.resolve(null),
            chrome.management ? chrome.management.getSelf() : Promise.resolve(null)
          ]).then(([bg, self]) => {
            return JSON.stringify({
              bg: !!bg,
              installType: self?.installType,
              enabled: self?.enabled
            });
          }).catch(err => err.message)
        `,
          awaitPromise: true
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
      console.log(`[Popup Console Log] ${args}`)
    } else if (msg.method === 'Log.entryAdded') {
      console.log(`[Popup System Log] ${msg.params.entry.text}`)
    } else if (msg.id === 3) {
      console.log(
        `[Popup Evaluation Result raw]: ${JSON.stringify(msg, null, 2)}`
      )

      // Close the connection after getting the state
      setTimeout(() => {
        ws.close()
        console.log('Done.')
      }, 3000)
    }
  })

  ws.on('error', (err) => {
    console.error('WebSocket Error:', err)
  })
}

main().catch(console.error)
