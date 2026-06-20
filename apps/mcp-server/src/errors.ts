export class CwcMcpError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'CWC_NOT_CONNECTED'
      | 'CWC_NO_CLIENT_ID'
      | 'CWC_NO_BROWSER'
      | 'CWC_TIMEOUT'
      | 'CWC_CLIPBOARD_EMPTY'
      | 'CWC_CLIPBOARD_UNCHANGED'
      | 'CWC_BAD_MESSAGE'
      | 'CWC_DISCONNECTED'
      | 'CWC_UNKNOWN_TICKET'
      | 'CWC_BUSY'
  ) {
    super(message)
    this.name = 'CwcMcpError'
  }
}

export const toErrorText = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
