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

export interface CwcTransport {
  readonly mode: CwcMode

  connect(): Promise<void>
  ensureReady(): Promise<void>
  sendInitializeChat(message: InitializeChatMessage): void
  onApplyResponse(handler: (message: ApplyChatResponseMessage) => void): void
  onClose(handler: (error?: unknown) => void): void
  status(): BridgeStatus
  close(): Promise<void>
}
