import clipboard from 'clipboardy'

export type ReadClipboard = () => Promise<string>

export const readSystemClipboard: ReadClipboard = async () => {
  try {
    return await clipboard.read()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not read the OS clipboard. On Linux, install xclip, xsel, or wl-clipboard as needed. Original error: ${message}`
    )
  }
}
