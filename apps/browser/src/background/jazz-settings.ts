export type JazzBrowserSettings = {
  enabled: boolean
  appId: string
  serverUrl: string
  secret: string
}

const ENABLED_KEY = 'cwc_jazz_enabled'
const APP_ID_KEY = 'cwc_jazz_app_id'
const SERVER_URL_KEY = 'cwc_jazz_server_url'
const SECRET_KEY = 'cwc_jazz_secret'

const DEFAULT_SERVER_URL = 'ws://localhost:1625'

function randomBase64url(bytes: number): string {
  const data = new Uint8Array(bytes)
  crypto.getRandomValues(data)
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function getJazzBrowserSettings(): Promise<JazzBrowserSettings> {
  const got = await chrome.storage.local.get([
    ENABLED_KEY,
    APP_ID_KEY,
    SERVER_URL_KEY,
    SECRET_KEY
  ])

  const enabled = got[ENABLED_KEY] === true
  const appId =
    typeof got[APP_ID_KEY] === 'string' && got[APP_ID_KEY].trim()
      ? got[APP_ID_KEY].trim()
      : ''

  const serverUrl =
    typeof got[SERVER_URL_KEY] === 'string' && got[SERVER_URL_KEY].trim()
      ? got[SERVER_URL_KEY].trim()
      : DEFAULT_SERVER_URL

  let secret =
    typeof got[SECRET_KEY] === 'string' && got[SECRET_KEY].length >= 43
      ? got[SECRET_KEY]
      : ''

  if (!secret) {
    secret = randomBase64url(32)
    await chrome.storage.local.set({ [SECRET_KEY]: secret })
  }

  return { enabled, appId, serverUrl, secret }
}

export async function setJazzEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [ENABLED_KEY]: enabled })
}

export async function setJazzLocalConfig(opts: {
  appId?: string
  serverUrl?: string
}): Promise<void> {
  const patch: Record<string, string> = {}
  if (opts.appId) patch[APP_ID_KEY] = opts.appId
  if (opts.serverUrl) patch[SERVER_URL_KEY] = opts.serverUrl
  await chrome.storage.local.set(patch)
}
