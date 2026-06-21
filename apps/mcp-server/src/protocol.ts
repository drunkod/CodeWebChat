export const DEFAULT_CWC_PORT = 55155

export const SECURITY_TOKENS = {
  BROWSERS: 'gemini-coder',
  VSCODE: 'gemini-coder-vscode'
} as const

export type WebPromptType = string

export type InitializeChatMessage = {
  action: 'initialize-chat'
  text: string
  url: string
  client_id: number
  model?: string
  target_browser_id?: number
  temperature?: number
  thinking_budget?: number
  reasoning_effort?: string
  top_p?: number
  system_instructions?: string
  options?: string[]
  raw_instructions?: string
  edit_format?: string
  prompt_type?: WebPromptType
  reuse_last_tab?: boolean
  invocation_count?: number
}

export type ApplyChatResponseMessage = {
  action: 'apply-chat-response'
  client_id: number
  raw_instructions?: string
  edit_format?: string
  url?: string
  response_text?: string
}

export type ClientIdAssignmentMessage = {
  action: 'client-id-assignment'
  client_id: number
}

export type BrowserConnectionStatusMessage = {
  action: 'browser-connection-status'
  connected_browsers?: Array<{
    id: number
    name?: string
  }>
}

export type CwcInboundMessage =
  | ApplyChatResponseMessage
  | ClientIdAssignmentMessage
  | BrowserConnectionStatusMessage
  | Record<string, unknown>
