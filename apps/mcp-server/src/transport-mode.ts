export type TransportKind = 'ws' | 'jazz'

export function parseTransportKind(argv: string[]): TransportKind {
  const i = argv.indexOf('--transport')
  const raw = (i >= 0 ? argv[i + 1] : process.env.CWC_TRANSPORT) ?? 'ws'
  if (raw !== 'ws' && raw !== 'jazz') {
    throw new Error(`invalid --transport "${raw}" (expected ws|jazz)`)
  }
  return raw
}
