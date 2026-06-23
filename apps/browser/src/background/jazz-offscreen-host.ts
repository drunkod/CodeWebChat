import type { JazzBrowserSettings } from './jazz-settings'

const OFFSCREEN_PATH = 'jazz-offscreen.html'

let creating: Promise<void> | null = null

export async function ensureJazzOffscreenDocument(
  settings: JazzBrowserSettings
): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH)

  if ('getContexts' in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
      documentUrls: [offscreenUrl]
    })
    if (contexts.length > 0) {
      // Already running — re-send settings in case the offscreen doc restarted
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

  // Send settings to the newly created offscreen document
  chrome.runtime
    .sendMessage({ action: 'cwc-jazz-init', settings })
    .catch(() => {})
}
