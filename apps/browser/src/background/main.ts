import { connect_websocket } from './websocket'
import { setup_keep_alive } from './keep-alive'
import { setup_message_listeners } from './message-handler'
import { clear_chat_init_data } from './clear-chat-init-data'
import { getJazzBrowserSettings } from './jazz-settings'
import { ensureJazzOffscreenDocument } from './jazz-offscreen-host'

async function init() {
  await clear_chat_init_data()

  const jazz = await getJazzBrowserSettings()

  if (jazz.enabled) {
    try {
      await ensureJazzOffscreenDocument(jazz)
      console.log('CodeWebChat Jazz offscreen document enabled')
    } catch (error) {
      console.warn(
        'Jazz offscreen document failed to create; falling back to WebSocket:',
        error
      )
      connect_websocket()
    }
  } else {
    connect_websocket()
  }

  setup_keep_alive()
  setup_message_listeners()
}

init().catch((error) => {
  console.error('Error during initialization:', error)
})
