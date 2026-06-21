import { randomUUID } from 'node:crypto'
import { CwcMcpError } from './errors.js'
import type { ReadClipboard } from './clipboard.js'
import type {
  ApplyChatResponseMessage,
  InitializeChatMessage
} from './protocol.js'
import type { CwcTransport } from './transport.js'

export type SendPromptInput = Omit<
  InitializeChatMessage,
  'action' | 'client_id'
> & { timeout_ms?: number }
export type PollResult =
  | { status: 'done'; response: string }
  | { status: 'pending'; ticket: string }
type RequestRecord = {
  promise: Promise<string>
  settled: boolean
  result?: string
  error?: unknown
}
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export class RequestRegistry {
  private readonly requests = new Map<string, RequestRecord>()
  private active_request: Promise<unknown> = Promise.resolve()
  private pending_apply: {
    resolve: (message: ApplyChatResponseMessage) => void
    reject: (error: CwcMcpError) => void
  } | null = null

  constructor(
    private readonly transport: CwcTransport,
    private readonly read_clipboard: ReadClipboard,
    private readonly clipboard_read_delay_ms = 250
  ) {
    this.transport.onApplyResponse((message) => {
      this.pending_apply?.resolve(message)
    })
    this.transport.onClose((error) => {
      const wrapped =
        error instanceof CwcMcpError
          ? error
          : new CwcMcpError(
              'CodeWebChat connection closed while waiting for Apply Response. Retry the tool call.',
              'CWC_DISCONNECTED'
            )
      this.pending_apply?.reject(wrapped)
    })
  }

  public begin(input: SendPromptInput): { ticket: string } {
    const ticket = randomUUID()
    const promise = this.serializedRun(input)
    const record: RequestRecord = { promise, settled: false }
    promise.then(
      (result) => {
        record.result = result
        record.settled = true
      },
      (error) => {
        record.error = error
        record.settled = true
      }
    )
    this.requests.set(ticket, record)
    return { ticket }
  }

  public async poll(ticket: string, wait_ms?: number): Promise<PollResult> {
    const record = this.requests.get(ticket)
    if (!record)
      throw new CwcMcpError(
        `Unknown or expired ticket: ${ticket}. Call send_to_codewebchat again.`,
        'CWC_UNKNOWN_TICKET'
      )
    const cap = Math.min(wait_ms ?? 10000, 30000)
    const pendingSentinel = Symbol('pending')
    let timer: ReturnType<typeof setTimeout> | undefined
    const timed = new Promise<typeof pendingSentinel>((resolve) => {
      timer = setTimeout(() => resolve(pendingSentinel), cap)
    })
    try {
      const outcome = await Promise.race([
        record.promise.then(
          () => 'settled' as const,
          () => 'settled' as const
        ),
        timed
      ])
      if (outcome === pendingSentinel && !record.settled)
        return { status: 'pending', ticket }
      this.requests.delete(ticket)
      if (record.error) throw record.error
      return { status: 'done', response: record.result ?? '' }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private serializedRun(input: SendPromptInput): Promise<string> {
    const previous = this.active_request
    let release!: () => void
    this.active_request = new Promise<void>((resolve) => {
      release = resolve
    })
    return (async () => {
      await previous.catch(() => undefined)
      try {
        return await this.run(input)
      } finally {
        release()
      }
    })()
  }

  private async run(input: SendPromptInput): Promise<string> {
    await this.transport.ensureReady()
    const client_id = this.transport.status().client_id
    if (client_id === null)
      throw new CwcMcpError(
        'CodeWebChat did not assign a client_id.',
        'CWC_NO_CLIENT_ID'
      )
    const before_clipboard = await this.read_clipboard()
    const timeout_ms = input.timeout_ms ?? 300000
    const apply_promise = this.waitForApply(client_id, timeout_ms)
    const message: InitializeChatMessage = {
      action: 'initialize-chat',
      client_id,
      text: input.text,
      url: input.url,
      model: input.model,
      target_browser_id: input.target_browser_id,
      temperature: input.temperature,
      thinking_budget: input.thinking_budget,
      reasoning_effort: input.reasoning_effort,
      top_p: input.top_p,
      system_instructions: input.system_instructions,
      options: input.options,
      raw_instructions: input.raw_instructions,
      edit_format: input.edit_format,
      prompt_type: input.prompt_type ?? 'edit-context',
      reuse_last_tab: input.reuse_last_tab,
      invocation_count: input.invocation_count
    }
    this.transport.sendInitializeChat(message)
    const apply = await apply_promise
    const response_text = apply.response_text
    if (typeof response_text === 'string' && response_text.trim()) {
      return response_text
    }
    await sleep(this.clipboard_read_delay_ms)
    const after_clipboard = await this.read_clipboard()
    if (!after_clipboard.trim())
      throw new CwcMcpError(
        'Apply Response completed, but the clipboard was empty.',
        'CWC_CLIPBOARD_EMPTY'
      )
    if (after_clipboard === before_clipboard)
      throw new CwcMcpError(
        'Apply Response completed, but the clipboard did not change. Refusing to return stale clipboard content.',
        'CWC_CLIPBOARD_UNCHANGED'
      )
    return after_clipboard
  }

  private waitForApply(
    client_id: number,
    timeout_ms: number
  ): Promise<ApplyChatResponseMessage> {
    return new Promise<ApplyChatResponseMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending_apply = null
        reject(
          new CwcMcpError(
            `Timed out after ${timeout_ms}ms waiting for Apply Response. The user must click Apply Response in the chatbot tab.`,
            'CWC_TIMEOUT'
          )
        )
      }, timeout_ms)
      this.pending_apply = {
        resolve: (message) => {
          if (message.client_id !== client_id) return
          clearTimeout(timer)
          this.pending_apply = null
          resolve(message)
        },
        reject: (error) => {
          clearTimeout(timer)
          this.pending_apply = null
          reject(error)
        }
      }
    })
  }
}
