import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const ENDPOINT = 'https://api.github.com/repos/hronaut/hronaut/releases'
const URL_PREFIX = 'https://github.com/hronaut/hronaut/releases/tag/'
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/u
const MAX_RELEASES = 200
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024

interface HistoryEntry {
  version: string
  title: string
  url: string
  publishedAt: string | null
  notes: string
}
interface GithubRelease {
  tag_name?: unknown
  name?: unknown
  html_url?: unknown
  published_at?: unknown
  body?: unknown
  draft?: unknown
  prerelease?: unknown
}
export interface ReleaseHistoryArtifact {
  schemaVersion: 1
  tag: string
  generatedAt: string
  releases: HistoryEntry[]
}

function notes(value: unknown): string {
  if (typeof value !== 'string') return ''
  const normalized = value.replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '')
    .replace(/<[^>]*>/gu, '')
    .replace(/\p{Cc}/gu, character => ['\t', '\n', '\r'].includes(character) ? character : '')
    .replace(/\n{4,}/gu, '\n\n\n').trim()
  return normalized.length <= 48_000 ? normalized : `${normalized.slice(0, 47_999).trimEnd()}…`
}

function priorEntry(value: GithubRelease): HistoryEntry {
  const version = typeof value.tag_name === 'string' ? value.tag_name.replace(/^v/u, '') : ''
  if (!VERSION.test(version) || value.tag_name !== `v${version}` || value.html_url !== `${URL_PREFIX}v${version}`) {
    throw new Error('Published release has an invalid version or URL')
  }
  if (typeof value.published_at !== 'string' || !Number.isFinite(Date.parse(value.published_at))) throw new Error('Published release has an invalid date')
  const title = typeof value.name === 'string' ? value.name.replace(/\p{Cc}/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 120) : ''
  return { version, title: title || `Hronaut ${version}`, url: value.html_url, publishedAt: new Date(value.published_at).toISOString(), notes: notes(value.body) }
}

export async function generateReleaseHistory(
  version: string,
  releaseNotes: string,
  options: { fetcher?: typeof fetch; token?: string; generatedAt?: Date } = {}
): Promise<ReleaseHistoryArtifact> {
  if (!VERSION.test(version)) throw new Error('Release history version is invalid')
  const fetcher = options.fetcher ?? fetch
  const generatedAt = (options.generatedAt ?? new Date()).toISOString()
  const releases: HistoryEntry[] = [{ version, title: `Hronaut ${version}`, url: `${URL_PREFIX}v${version}`, publishedAt: null, notes: notes(releaseNotes) }]
  const seen = new Set([version])
  let complete = false
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetcher(`${ENDPOINT}?per_page=100&page=${page}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'Hronaut release history generator',
        'x-github-api-version': '2026-03-10',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
      },
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw new Error(`Published release history request failed with ${response.status}`)
    const payload: unknown = await response.json()
    if (!Array.isArray(payload) || payload.length > 100) throw new Error('Published release history page is invalid')
    for (const value of payload as GithubRelease[]) {
      // A tag or a prepared draft is not evidence of a published release.
      if (value?.draft !== false || value?.prerelease !== false) continue
      const entry = priorEntry(value)
      if (seen.has(entry.version)) throw new Error('Published release history contains a duplicate or already published candidate')
      seen.add(entry.version)
      releases.push(entry)
      if (releases.length > MAX_RELEASES) throw new Error('Published release history exceeds the supported 200-release limit')
    }
    if (payload.length < 100) { complete = true; break }
  }
  if (!complete) throw new Error('Published release history pagination did not complete')
  const artifact: ReleaseHistoryArtifact = { schemaVersion: 1, tag: `v${version}`, generatedAt, releases }
  if (Buffer.byteLength(JSON.stringify(artifact)) + 1 > MAX_ARTIFACT_BYTES) throw new Error('Published release history artifact exceeds 4 MiB')
  return artifact
}

async function main(): Promise<void> {
  const [version, notesPath, outputPath] = process.argv.slice(2)
  if (!version || !notesPath || !outputPath) throw new Error('Usage: release-history.ts VERSION RELEASE_NOTES OUTPUT_JSON')
  const artifact = await generateReleaseHistory(version, await readFile(notesPath, 'utf8'), { token: process.env.GH_TOKEN })
  await writeFile(outputPath, `${JSON.stringify(artifact)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Unable to generate release history'); process.exitCode = 1 })
}
