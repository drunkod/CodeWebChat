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

type PushSchemaCatalogue = (opts: {
  appId: string
  serverUrl: string
  adminSecret: string
  schemaDir: string
}) => Promise<void>

async function loadJazzDev(): Promise<{
  startLocalJazzServer: StartLocalJazzServer
  pushSchemaCatalogue: PushSchemaCatalogue
}> {
  const mod = (await import('jazz-tools/dev')) as any
  if (!mod.startLocalJazzServer || !mod.pushSchemaCatalogue) {
    throw new Error('jazz-tools/dev does not export required functions')
  }
  return {
    startLocalJazzServer: mod.startLocalJazzServer,
    pushSchemaCatalogue: mod.pushSchemaCatalogue
  }
}

export async function startSyncServer(
  config: JazzConfig
): Promise<SyncServerHandle> {
  const { startLocalJazzServer } = await loadJazzDev()
  const server = await startLocalJazzServer({
    appId: config.appId,
    port: config.port,
    dataDir: config.dataDir,
    backendSecret: config.backendSecret ?? 'cwc-rt-backend',
    adminSecret: config.adminSecret ?? 'cwc-rt-admin',
    enableLogs: process.env.JAZZ_DEBUG === '1'
  })

  return {
    url: server.url,
    port: server.port,
    appId: server.appId,
    stop: server.stop
  }
}

export async function pushSchema(
  config: JazzConfig,
  serverUrl: string
): Promise<void> {
  const { pushSchemaCatalogue } = await loadJazzDev()
  const schemaDir = new URL(
    '../../../packages/shared/src/jazz',
    import.meta.url
  ).pathname
  try {
    await pushSchemaCatalogue({
      appId: config.appId,
      serverUrl,
      adminSecret: config.adminSecret ?? 'cwc-rt-admin',
      schemaDir
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (/Schema publish failed:\s*404\s+Not Found/i.test(msg)) {
      console.warn(
        `[cwc-mcp-server] Jazz schema admin endpoint is unavailable on this local server (${serverUrl}). Continuing without schema publication; cross-peer sync may not work until Jazz exposes /apps/{appId}/admin/schemas.`
      )
      return
    }
    throw error
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
  await pushSchema(config, handle.url)
  registerSyncServerShutdown(handle)
  return handle
}
