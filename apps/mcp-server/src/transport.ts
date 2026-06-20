import type {
  ApplyChatResponseMessage,
  InitializeChatMessage
} from './protocol.js'

export type CwcMode = 'client' | 'host'

export type BridgeStatus = {
  mode: CwcMode
  hosting: boolean
  websocket_connected: boolean
  client_id: number | null
  browser_connected: boolean
  connected_browser_count: number
}

/**
 * A pure transport. It knows how to become ready, push one initialize-chat to
 * the browser, and emit apply-chat-response / close events. It does NOT wait for
 * the response or touch the clipboard — that lives in RequestRegistry.
 */
export interface CwcTransport {
  readonly mode: CwcMode

  /** Establish the transport WITHOUT requiring a browser (used by cwc_status). */
  connect(): Promise<void>

  /** Establish the transport AND require a browser ready to receive (used before sending). */
  ensureReady(): Promise<void>

  /** Deliver one initialize-chat. Fire-and-forget; the reply arrives via onApplyResponse. */
  sendInitializeChat(message: InitializeChatMessage): void

  onApplyResponse(handler: (message: ApplyChatResponseMessage) => void): void
  onClose(handler: (error?: unknown) => void): void

  status(): BridgeStatus

  close(): Promise<void>
}
