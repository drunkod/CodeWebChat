import type { JazzConfig } from './jazz-config.js'

export type SyncServerHandle = {
  url: string
  port: number
  appId: string
  stop: () => Promise<void>
}

type StartLocalJazzServer = (opts: Record<string, unknown>) => Promise<{
  url: string
  port: number
  appId: string
  stop: () => Promise<void>
}>

async function loadStartLocalJazzServer(): Promise<StartLocalJazzServer> {
  const mod = (await import('jazz-tools/dev')) as {
    startLocalJazzServer?: StartLocalJazzServer
  }
  if (!mod.startLocalJazzServer) {
    throw new Error('jazz-tools/dev does not export startLocalJazzServer')
  }
  return mod.startLocalJazzServer
}

export async function startSyncServer(
  config: JazzConfig
): Promise<SyncServerHandle> {
  const startLocalJazzServer = await loadStartLocalJazzServer()
  const server = await startLocalJazzServer({
    appId: config.appId,
    port: config.port,
    dataDir: config.dataDir,
    enableLogs: process.env.JAZZ_DEBUG === '1'
  })
  return {
    url: server.url,
    port: server.port,
    appId: server.appId,
    stop: server.stop
  }
}

export async function startSyncServerSafe(
  config: JazzConfig
): Promise<SyncServerHandle> {
  try {
    return await startSyncServer(config)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (/EADDRINUSE|in use|address already/i.test(msg)) {
      throw new Error(
        `Jazz sync port ${config.port} is already in use. Another cwc-mcp-server (or a stray jazz server) may be running. Stop it, or set JAZZ_PORT to a free port.`
      )
    }
    throw error
  }
}

export function registerSyncServerShutdown(handle: SyncServerHandle): void {
  const stop = () => {
    void handle.stop().catch(() => undefined)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  process.once('beforeExit', stop)
}

export async function ensureSyncServer(
  config: JazzConfig
): Promise<SyncServerHandle | null> {
  if (process.env.JAZZ_EXTERNAL_SERVER === '1') {
    return null
  }
  const handle = await startSyncServerSafe(config)
  registerSyncServerShutdown(handle)
  return handle
}
