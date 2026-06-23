import { startJazzClient } from './jazz-client'
import type { ChatRequestRow } from '@shared/jazz/schema'
import type { JazzBrowserSettings } from './jazz-settings'

async function askServiceWorker(req: ChatRequestRow): Promise<string> {
  const response = await chrome.runtime.sendMessage({
    action: 'cwc-jazz-process-request',
    request: req
  })

  if (!response?.ok) {
    throw new Error(
      response?.error ?? 'Service worker failed to process Jazz request'
    )
  }

  return response.response_text as string
}

function waitForSettings(): Promise<JazzBrowserSettings> {
  return new Promise((resolve) => {
    chrome.runtime.onMessage.addListener(function handler(message) {
      if (message?.action === 'cwc-jazz-init' && message.settings) {
        chrome.runtime.onMessage.removeListener(handler)
        resolve(message.settings as JazzBrowserSettings)
      }
    })
  })
}

async function main() {
  const settings = await waitForSettings()

  const handle = await startJazzClient({
    settings,
    onRequest: askServiceWorker
  })

  if (handle) {
    console.log('CodeWebChat Jazz offscreen transport enabled')
  } else {
    console.warn('Jazz offscreen started but client did not initialize')
  }
}

main().catch((error) => {
  console.error('Jazz offscreen initialization failed:', error)
})
