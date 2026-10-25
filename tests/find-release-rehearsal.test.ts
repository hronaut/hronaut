import { describe, expect, it } from 'vitest'
import { REHEARSED_JOBS, findReleaseRehearsal, type GitHubGet } from '../scripts/find-release-rehearsal.ts'

const repository = 'hronaut/hronaut'
const tree = 'tree-of-the-tag'

interface Rehearsal {
  id: number
  sha: string
  tree?: string
  branch?: string | null
  event?: string
  conclusion?: string | null
  owner?: string
  jobs?: Array<{ name: string; conclusion: string | null }>
}

const passedJobs = () => [...REHEARSED_JOBS, 'integration', 'package-release-candidate (ubuntu-latest, package:linux, linux)']
  .map((name) => ({ name, conclusion: 'success' }))

/** The GitHub API as these rehearsals give it, recording the paths read. */
function github(rehearsals: Rehearsal[]): { get: GitHubGet; paths: string[] } {
  const paths: string[] = []
  const get: GitHubGet = async (path) => {
    paths.push(path)
    if (path === `repos/${repository}/actions/workflows/ci.yml/runs?event=workflow_dispatch&status=success&per_page=30`) {
      return {
        workflow_runs: rehearsals.map((rehearsal) => ({
          id: rehearsal.id,
          head_sha: rehearsal.sha,
          head_branch: rehearsal.branch === undefined ? 'release/3.13.0' : rehearsal.branch,
          event: rehearsal.event ?? 'workflow_dispatch',
          conclusion: rehearsal.conclusion === undefined ? 'success' : rehearsal.conclusion,
          head_repository: { full_name: rehearsal.owner ?? repository }
        }))
      }
    }
    const commit = /^repos\/hronaut\/hronaut\/git\/commits\/(.+)$/.exec(path)
    if (commit) return { tree: { sha: rehearsals.find((rehearsal) => rehearsal.sha === commit[1])?.tree ?? tree } }
    const jobs = /^repos\/hronaut\/hronaut\/actions\/runs\/(\d+)\/jobs\?filter=latest&per_page=100$/.exec(path)
    if (jobs) return { jobs: rehearsals.find((rehearsal) => rehearsal.id === Number(jobs[1]))?.jobs ?? passedJobs() }
    throw new Error(`Unexpected path ${path}`)
  }
  return { get, paths }
}

describe('findReleaseRehearsal', () => {
  // The release ran validate and all eight Electron shards again on the tree its rehearsal had just passed.
  it('finds the rehearsal that passed static validation and every Electron shard on the same tree', async () => {
    const { get, paths } = github([
      { id: 3, sha: 'newer', tree: 'another-tree' },
      { id: 2, sha: 'rehearsed' },
      { id: 1, sha: 'older' }
    ])
    await expect(findReleaseRehearsal(get, repository, tree)).resolves.toBe(2)
    // The older run is not read once one is found.
    expect(paths.some((path) => path.includes('/runs/1/'))).toBe(false)
  })

  it('passes over a newer run on the same tree whose shard failed to an older one that passed', async () => {
    const { get } = github([
      { id: 9, sha: 'rerun', jobs: passedJobs().map((job) => job.name === 'Electron integration shard 2/8' ? { ...job, conclusion: 'failure' } : job) },
      { id: 8, sha: 'rehearsed' }
    ])
    await expect(findReleaseRehearsal(get, repository, tree)).resolves.toBe(8)
  })

  it.each<[string, Partial<Rehearsal>]>([
    ['on another branch than a release branch', { branch: 'main' }],
    ['without a branch', { branch: null }],
    ['of a fork', { owner: 'someone/hronaut' }],
    ['started by another event', { event: 'push' }],
    ['that did not succeed', { conclusion: 'failure' }],
    ['on another tree', { tree: 'another-tree' }],
    ['whose latest attempt failed a shard', { jobs: passedJobs().map((job) => job.name === 'Electron integration shard 5/8' ? { ...job, conclusion: 'failure' } : job) }],
    ['that skipped validation', { jobs: passedJobs().map((job) => job.name === 'validate' ? { ...job, conclusion: 'skipped' } : job) }],
    ['missing a shard', { jobs: passedJobs().filter((job) => job.name !== 'Electron integration shard 8/8') }]
  ])('takes no rehearsal %s', async (_case, rehearsal) => {
    const { get } = github([{ id: 7, sha: 'rehearsed', ...rehearsal }])
    await expect(findReleaseRehearsal(get, repository, tree)).resolves.toBeUndefined()
  })

  it('names validate and the eight shards ci.yml and release.yml run', () => {
    expect(REHEARSED_JOBS).toEqual(['validate', ...[1, 2, 3, 4, 5, 6, 7, 8].map((shard) => `Electron integration shard ${shard}/8`)])
  })
})
