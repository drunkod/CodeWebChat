import { connect_websocket } from './websocket'
import { setup_keep_alive } from './keep-alive'
import { setup_message_listeners } from './message-handler'
import { clear_chat_init_data } from './clear-chat-init-data'
import { getJazzBrowserSettings } from './jazz-settings'
import { startJazzClient } from './jazz-client'
import { driveChatbotAndCaptureReply } from './jazz-capture'

async function init() {
  await clear_chat_init_data()

  const jazz = await getJazzBrowserSettings()

  if (jazz.enabled) {
    const handle = await startJazzClient({
      onRequest: driveChatbotAndCaptureReply
    })

    if (handle) {
      console.log('CodeWebChat Jazz transport enabled')
    } else {
      console.warn(
        'Jazz transport requested but did not start; falling back to WebSocket'
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
