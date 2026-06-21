import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RequestRegistry } from './request-registry.js'
import { ReviewHandoff } from './review-handoff.js'
import type { GitRunner } from './git-context.js'
import type { CwcTransport, BridgeStatus } from './transport.js'
import type {
  ApplyChatResponseMessage,
  InitializeChatMessage
} from './protocol.js'

// --- a fake transport that captures sends and lets the test emit apply ---
class FakeTransport implements CwcTransport {
  readonly mode = 'host' as const
  lastMessage: InitializeChatMessage | null = null
  private applyHandler: (m: ApplyChatResponseMessage) => void = () => {}
  private closeHandler: (e?: unknown) => void = () => {}

  onApplyResponse(h: (m: ApplyChatResponseMessage) => void): void {
    this.applyHandler = h
  }
  onClose(h: (e?: unknown) => void): void {
    this.closeHandler = h
  }
  async connect(): Promise<void> {}
  async ensureReady(): Promise<void> {}
  sendInitializeChat(message: InitializeChatMessage): void {
    this.lastMessage = message
  }
  status(): BridgeStatus {
    return {
      mode: 'host',
      hosting: true,
      websocket_connected: true,
      client_id: 1,
      browser_connected: true,
      connected_browser_count: 1
    }
  }
  async close(): Promise<void> {}
  emitApply(m: ApplyChatResponseMessage): void {
    this.applyHandler(m)
  }
}

async function waitFor(
  cond: () => boolean,
  timeout = 1000
): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const SHA = 'abc123def456'

const fakeGit: GitRunner = async (args) => {
  const key = args.join(' ')
  const table: Record<string, string> = {
    'rev-parse --abbrev-ref HEAD': 'draft/x',
    [`rev-parse origin/draft/x`]: SHA,
    'rev-parse HEAD': SHA,
    [`log -1 --pretty=%s ${SHA}`]: 'Add review handoff v1',
    [`log -1 --pretty=%b ${SHA}`]: 'body summary',
    'remote get-url origin': 'git@github.com:owner/repo.git',
    [`diff --name-only ${SHA}~1 ${SHA}`]: 'a.ts\nb.ts'
  }
  if (key in table) return table[key]
  // base 'main' not present -> rev-parse --verify --quiet main should fail
  if (key === 'rev-parse --verify --quiet main') throw new Error('unknown rev')
  throw new Error(`unexpected git call: ${key}`)
}

const REVIEW =
  'Verdict: needs_changes\n\nsome prose\n\n```json\n' +
  JSON.stringify({
    verdict: 'needs_changes',
    risk: 'medium',
    findings: [{ severity: 'high', path: 'a.ts', title: 'x' }],
    tests: ['t1'],
    editor_patch_plan: ['p1']
  }) +
  '\n```\n'

test('v1: prepare builds a packet and fills the prompt', async () => {
  const transport = new FakeTransport()
  const registry = new RequestRegistry(transport, async () => '', 0)
  const rh = new ReviewHandoff(registry, fakeGit)

  const { packet, prompt } = await rh.prepare({ push: false, repo_path: '/repo' })
  assert.equal(packet.repo_name, 'owner/repo')
  assert.equal(packet.draft_branch, 'draft/x')
  assert.equal(packet.commit_sha, SHA)
  assert.deepEqual(packet.changed_files, ['a.ts', 'b.ts'])
  assert.ok(prompt.includes(SHA))
  assert.ok(!prompt.includes('{{'), 'no unresolved placeholders')
})

test('v1: request_review → import_review_feedback returns parsed review (not stale)', async () => {
  const transport = new FakeTransport()
  let reads = 0
  const readClipboard = async () => (reads++ === 0 ? 'OLD' : REVIEW)
  const registry = new RequestRegistry(transport, readClipboard, 0)
  const rh = new ReviewHandoff(registry, fakeGit)

  const { ticket, reviewed_sha } = await rh.requestReview({
    chatgpt_url: 'https://chatgpt.com/g/demo',
    push: false,
    repo_path: '/repo'
  })
  assert.equal(reviewed_sha, SHA)

  // wait until the prompt was actually sent (pending_apply is now armed)
  await waitFor(() => transport.lastMessage !== null)
  assert.equal(transport.lastMessage?.prompt_type, 'edit-context')

  // simulate the user clicking Apply Response
  transport.emitApply({ action: 'apply-chat-response', client_id: 1 })

  const res = await rh.importFeedback(ticket, 2000)
  assert.equal(res.status, 'done')
  assert.equal((res as { parsed: boolean }).parsed, true)
  if (res.status === 'done' && res.parsed) {
    assert.equal(res.verdict, 'needs_changes')
    assert.equal(res.findings.length, 1)
    assert.equal(res.stale, false) // HEAD (SHA) == reviewed_sha
  }
})

test('v1: import flags stale when HEAD drifts from the reviewed commit', async () => {
  const transport = new FakeTransport()
  let reads = 0
  const readClipboard = async () => (reads++ === 0 ? 'OLD' : REVIEW)
  const registry = new RequestRegistry(transport, readClipboard, 0)

  // git where HEAD has moved away from the reviewed SHA
  const movedGit: GitRunner = async (args) => {
    const key = args.join(' ')
    if (key === 'rev-parse HEAD') return 'NEWHEAD999'
    return fakeGit(args, '/repo')
  }
  const rh = new ReviewHandoff(registry, movedGit)

  const { ticket } = await rh.requestReview({
    chatgpt_url: 'https://chatgpt.com/g/demo',
    push: false,
    repo_path: '/repo'
  })
  await waitFor(() => transport.lastMessage !== null)
  transport.emitApply({ action: 'apply-chat-response', client_id: 1 })
  const res = await rh.importFeedback(ticket, 2000)
  assert.equal(res.status, 'done')
  if (res.status === 'done') {
    assert.equal(res.stale, true)
  }
})
