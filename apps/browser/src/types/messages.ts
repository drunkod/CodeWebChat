type ChatInitializedMessage = {
  action: 'chat-initialized'
}

type ApplyChatResponseMessage = {
  action: 'apply-chat-response'
  client_id: number
  raw_instructions?: string
  edit_format?: string
  url?: string
}

type FinishedRespondingMessage = {
  action: 'finished-responding'
}

type ReplyTextMessage = {
  action: 'cwc-reply-text'
  request_id: string
  response_text: string
}

export type Message =
  | ChatInitializedMessage
  | ApplyChatResponseMessage
  | FinishedRespondingMessage
  | ReplyTextMessage
