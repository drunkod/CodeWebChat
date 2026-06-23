import type { JazzBrowserSettings } from './jazz-settings'

const OFFSCREEN_PATH = 'jazz-offscreen.html'

let creating: Promise<void> | null = null
let pendingSettings: JazzBrowserSettings | null = null

// Listen for the offscreen document's "ready" signal, then deliver settings.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'cwc-jazz-offscreen-ready' && pendingSettings) {
    chrome.runtime
      .sendMessage({ action: 'cwc-jazz-init', settings: pendingSettings })
      .catch(() => {})
  }
})

export async function ensureJazzOffscreenDocument(
  settings: JazzBrowserSettings
): Promise<void> {
  pendingSettings = settings

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH)

  if ('getContexts' in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
      documentUrls: [offscreenUrl]
    })
    if (contexts.length > 0) {
      // Already running — re-send settings in case the offscreen doc restarted.
      chrome.runtime
        .sendMessage({ action: 'cwc-jazz-init', settings })
        .catch(() => {})
      return
    }
  }

  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['WORKERS' as chrome.offscreen.Reason],
      justification:
        'Run the Jazz WebAssembly sync client in a DOM-capable extension document.'
    })
  }

  await creating
  creating = null
  // Settings will be sent when the offscreen doc fires cwc-jazz-offscreen-ready.
}
