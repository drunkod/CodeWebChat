import browser from 'webextension-polyfill'
import type { ChatRequestRow } from '@shared/jazz/schema'
import type { InitializeChatMessage } from '@shared/types/websocket-message'
import { handle_messages } from './message-handler'

type ReplyTextMessage = {
  action: 'cwc-reply-text'
  request_id: string
  response_text: string
}

type PendingReply = {
  resolve: (text: string) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingReplies = new Map<string, PendingReply>()
let listenerInstalled = false

const DEFAULT_CAPTURE_TIMEOUT_MS = 900000

function isReplyTextMessage(message: unknown): message is ReplyTextMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    (message as { action?: unknown }).action === 'cwc-reply-text' &&
    typeof (message as { request_id?: unknown }).request_id === 'string' &&
    typeof (message as { response_text?: unknown }).response_text === 'string'
  )
}

function ensureReplyListener(): void {
  if (listenerInstalled) return
  listenerInstalled = true

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isReplyTextMessage(message)) return false

    const pending = pendingReplies.get(message.request_id)
    if (!pending) return false

    clearTimeout(pending.timer)
    pendingReplies.delete(message.request_id)
    pending.resolve(message.response_text)

    return false
  })
}

function waitForReplyText(
  requestId: string,
  timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS
): Promise<string> {
  ensureReplyListener()

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingReplies.delete(requestId)
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for reply text for request ${requestId}`
        )
      )
    }, timeoutMs)

    pendingReplies.set(requestId, { resolve, reject, timer })
  })
}

export async function driveChatbotAndCaptureReply(
  req: ChatRequestRow
): Promise<string> {
  const responsePromise = waitForReplyText(req.request_id)

  handle_messages({
    action: 'initialize-chat',
    client_id: 1,
    request_id: req.request_id,
    text: req.text,
    url: req.url,
    prompt_type: req.prompt_type
  } as InitializeChatMessage)

  return responsePromise
}
