import { appendFile } from 'node:fs/promises'
import { isMainModule } from './is-main-module.ts'

/** The ci.yml jobs whose results a release takes from its rehearsal: static validation and every Electron shard. */
export const REHEARSED_JOBS = ['validate', ...Array.from({ length: 12 }, (_, index) => `Electron integration shard ${index + 1}/12`)]

/** Reads one GitHub REST API path, such as `repos/owner/name/git/commits/<sha>`. */
export type GitHubGet = (path: string) => Promise<unknown>

interface WorkflowRun {
  id: number
  head_sha: string
  head_branch: string | null
  event: string
  conclusion: string | null
  head_repository?: { full_name?: string } | null
}

interface WorkflowJob {
  name: string
  conclusion: string | null
}

/**
 * The release rehearsal that already passed on `tree`: a ci.yml run dispatched on one of the repository's own
 * `release/` branches whose latest attempt passed static validation and every Electron shard on a commit with that
 * tree. The same files went through the same checks, so the release takes their results instead of running them again.
 */
export async function findReleaseRehearsal(get: GitHubGet, repository: string, tree: string): Promise<number | undefined> {
  const { workflow_runs: runs } = await get(`repos/${repository}/actions/workflows/ci.yml/runs?event=workflow_dispatch&status=success&per_page=30`) as { workflow_runs: WorkflowRun[] }
  for (const run of runs) {
    // A run of a fork's branch, or one that was not a rehearsal, never stands for a release.
    if (run.event !== 'workflow_dispatch' || run.conclusion !== 'success' || !run.head_branch?.startsWith('release/')
      || run.head_repository?.full_name !== repository) continue
    const commit = await get(`repos/${repository}/git/commits/${run.head_sha}`) as { tree?: { sha?: string } }
    if (commit.tree?.sha !== tree) continue
    const { jobs } = await get(`repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`) as { jobs: WorkflowJob[] }
    if (REHEARSED_JOBS.every((name) => jobs.some((job) => job.name === name && job.conclusion === 'success'))) return run.id
  }
  return undefined
}

if (isMainModule(import.meta.url)) {
  const tree = process.argv[2]
  const repository = process.env.GITHUB_REPOSITORY
  const token = process.env.GH_TOKEN
  if (!tree || !repository || !token) throw new Error('Usage: GITHUB_REPOSITORY=<owner/name> GH_TOKEN=<token> node scripts/find-release-rehearsal.ts <tree>')
  const api = process.env.GITHUB_API_URL ?? 'https://api.github.com'
  const get: GitHubGet = async (path) => {
    const response = await fetch(`${api}/${path}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' }
    })
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`)
    return response.json()
  }
  let run: number | undefined
  try {
    run = await findReleaseRehearsal(get, repository, tree)
  } catch (error) {
    // Without the rehearsal's results the release runs every check itself.
    console.log(`::warning::Could not look for a release rehearsal, so every check runs: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (run === undefined) {
    console.log(`No passing release rehearsal tested tree ${tree}; every check runs.`)
  } else {
    console.log(`::notice::Release rehearsal ${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repository}/actions/runs/${run} passed static validation and every Electron shard on tree ${tree}; the release takes those results.`)
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `run_id=${run}\n`)
  }
}
