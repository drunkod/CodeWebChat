import { randomUUID } from 'node:crypto'

export type JazzConfig = {
  appId: string
  port: number
  dataDir: string
  serverUrl: string
}

export function resolveJazzConfig(): JazzConfig {
  const port = Number(process.env.JAZZ_PORT ?? 1625)
  const appId = process.env.JAZZ_APP_ID ?? randomUUID()
  const dataDir = process.env.JAZZ_DATA_DIR ?? '.jazz/server'
  const serverUrl = process.env.JAZZ_SERVER_URL ?? `ws://localhost:${port}`
  return { appId, port, dataDir, serverUrl }
}
