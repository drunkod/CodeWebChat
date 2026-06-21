import {
  buildPacket,
  currentHead,
  type BuildPacketOptions,
  type GitRunner,
  type HandoffPacket
} from './git-context.js'
import { fillHandoff, parseReview, type ParsedReview } from './review-prompts.js'
import type { RequestRegistry } from './request-registry.js'

export type RequestReviewOptions = BuildPacketOptions & {
  chatgpt_url: string
  timeout_ms?: number
}

export type PrepareResult = { packet: HandoffPacket; prompt: string }

export type RequestReviewResult = {
  ticket: string
  reviewed_sha: string
  packet: HandoffPacket
}

export type ImportResult =
  | { status: 'pending'; ticket: string }
  | ({
      status: 'done'
      parsed: true
      stale: boolean
      reviewed_sha: string | null
      current_head: string | null
    } & ParsedReview)
  | {
      status: 'done'
      parsed: false
      stale: boolean
      reviewed_sha: string | null
      current_head: string | null
      raw: string
    }

/**
 * v1 orchestration over the existing RequestRegistry:
 *   prepare → request_review (send) → import_review_feedback (poll + parse + SHA gate).
 * Git access is injected (GitRunner) so it is unit-testable without a real repo.
 */
export class ReviewHandoff {
  private readonly meta = new Map<
    string,
    { reviewed_sha: string; repo_path: string }
  >()

  constructor(
    private readonly registry: RequestRegistry,
    private readonly git: GitRunner
  ) {}

  async prepare(options: BuildPacketOptions): Promise<PrepareResult> {
    const packet = await buildPacket(this.git, options)
    const prompt = fillHandoff(packet)
    return { packet, prompt }
  }

  async requestReview(
    options: RequestReviewOptions
  ): Promise<RequestReviewResult> {
    const { packet, prompt } = await this.prepare(options)
    const { ticket } = this.registry.begin({
      url: options.chatgpt_url,
      text: prompt,
      prompt_type: 'edit-context',
      timeout_ms: options.timeout_ms
    })
    this.meta.set(ticket, {
      reviewed_sha: packet.commit_sha,
      repo_path: options.repo_path ?? process.cwd()
    })
    return { ticket, reviewed_sha: packet.commit_sha, packet }
  }

  async importFeedback(ticket: string, wait_ms?: number): Promise<ImportResult> {
    const result = await this.registry.poll(ticket, wait_ms)
    if (result.status === 'pending') {
      return { status: 'pending', ticket }
    }

    const meta = this.meta.get(ticket)
    this.meta.delete(ticket)

    let current_head: string | null = null
    let stale = false
    if (meta) {
      try {
        current_head = await currentHead(this.git, meta.repo_path)
        stale = current_head !== meta.reviewed_sha
      } catch {
        current_head = null
      }
    }

    const parsed = parseReview(result.response)
    if (!parsed) {
      return {
        status: 'done',
        parsed: false,
        stale,
        reviewed_sha: meta?.reviewed_sha ?? null,
        current_head,
        raw: result.response
      }
    }
    return {
      status: 'done',
      parsed: true,
      stale,
      reviewed_sha: meta?.reviewed_sha ?? null,
      current_head,
      ...parsed
    }
  }
}
