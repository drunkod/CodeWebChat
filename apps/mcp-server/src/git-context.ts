import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const DEFAULT_REVIEW_BASE_BRANCH = 'dev'

export const DEFAULT_REVIEW_FOCUS =
  'Correctness and regressions first, then test gaps, then maintainability.'

export type HandoffPacket = {
  repo_name: string
  base_branch: string
  draft_branch: string
  commit_sha: string
  commit_title: string
  change_summary: string
  review_focus: string
  changed_files: string[]
}

export type BuildPacketOptions = {
  repo_path?: string
  base_branch?: string
  review_focus?: string
  summary?: string
  push?: boolean
}

/** Injectable git runner: runs `git <args>` in `cwd`, returns stdout (or throws). */
export type GitRunner = (args: string[], cwd: string) => Promise<string>

export const realGitRunner: GitRunner = async (args, cwd) => {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 4 * 1024 * 1024
  })
  return stdout
}

async function tryGit(
  git: GitRunner,
  args: string[],
  cwd: string
): Promise<string | null> {
  try {
    return (await git(args, cwd)).trim()
  } catch {
    return null
  }
}

export async function currentHead(
  git: GitRunner,
  cwd: string
): Promise<string> {
  return (await git(['rev-parse', 'HEAD'], cwd)).trim()
}

export async function buildPacket(
  git: GitRunner,
  options: BuildPacketOptions
): Promise<HandoffPacket> {
  const cwd = options.repo_path ?? process.cwd()
  const base =
    options.base_branch ??
    process.env.CWC_REVIEW_BASE_BRANCH ??
    DEFAULT_REVIEW_BASE_BRANCH

  const draft =
    (await tryGit(git, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd)) ?? 'HEAD'

  // Push first so the reviewer can fetch the commit from GitHub (unless disabled).
  if (options.push !== false) {
    await tryGit(git, ['push', '-u', 'origin', draft], cwd)
  }

  const sha =
    (await tryGit(git, ['rev-parse', `origin/${draft}`], cwd)) ??
    (await tryGit(git, ['rev-parse', 'HEAD'], cwd)) ??
    'unknown'

  const title =
    (await tryGit(git, ['log', '-1', '--pretty=%s', sha], cwd)) ?? ''

  let summary = options.summary ?? ''
  if (!summary) {
    summary =
      (await tryGit(git, ['log', '-1', '--pretty=%b', sha], cwd)) || title
  }

  let repoName = 'unknown/unknown'
  const remote = await tryGit(git, ['remote', 'get-url', 'origin'], cwd)
  if (remote) {
    repoName = remote.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '')
  }

  // Changed files vs base; fall back to the last commit if base is unknown locally.
  const baseExists =
    (await tryGit(git, ['rev-parse', '--verify', '--quiet', base], cwd)) !==
    null
  const diffOut = baseExists
    ? await tryGit(git, ['diff', '--name-only', `${base}...${sha}`], cwd)
    : await tryGit(git, ['diff', '--name-only', `${sha}~1`, sha], cwd)
  const changed = (diffOut ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return {
    repo_name: repoName,
    base_branch: base,
    draft_branch: draft,
    commit_sha: sha,
    commit_title: title,
    change_summary: summary,
    review_focus: options.review_focus ?? DEFAULT_REVIEW_FOCUS,
    changed_files: changed
  }
}
