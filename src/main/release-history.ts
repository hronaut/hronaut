import type { AppReleaseHistoryEntry, AppReleaseHistoryPage } from '../shared/types.js'

const RELEASES_PER_PAGE = 10
const MAX_PAGE = 20
const MAX_RESPONSE_LENGTH = 2_500_000
const MAX_NOTES_LENGTH = 200_000
const MAX_TITLE_LENGTH = 200
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1_000
const RELEASE_TAG_PATTERN = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/
const NEXT_LINK_PATTERN = /<[^>]+>;\s*rel="next"/

type ReleaseHistoryFetch = typeof globalThis.fetch

interface CachedReleaseHistoryPage {
  expiresAt: number
  value: AppReleaseHistoryPage
}

export interface ReleaseHistoryServiceOptions {
  fetch?: ReleaseHistoryFetch
  now?: () => number
  cacheTtlMs?: number
}

function clonePage(page: AppReleaseHistoryPage): AppReleaseHistoryPage {
  return {
    ...page,
    releases: page.releases.map((release) => ({ ...release }))
  }
}

function boundedString(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maximum) return undefined
  return trimmed
}

function releaseEntry(value: unknown): AppReleaseHistoryEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.draft === true || candidate.prerelease === true) return undefined
  const tag = boundedString(candidate.tag_name, 80)
  const version = tag && RELEASE_TAG_PATTERN.exec(tag)?.[1]
  const publishedAt = boundedString(candidate.published_at, 80)
  if (!tag || !version || !publishedAt || !Number.isFinite(Date.parse(publishedAt))) return undefined
  const notes = typeof candidate.body === 'string'
    ? candidate.body.slice(0, MAX_NOTES_LENGTH).trim()
    : ''
  const name = boundedString(candidate.name, MAX_TITLE_LENGTH)
  return {
    version,
    title: name ?? `Hronaut ${version}`,
    publishedAt: new Date(publishedAt).toISOString(),
    url: `https://github.com/hronaut/hronaut/releases/tag/${tag}`,
    notes
  }
}

function parseReleaseHistoryPage(page: number, text: string, link: string | null): AppReleaseHistoryPage {
  if (text.length > MAX_RESPONSE_LENGTH) throw new Error('GitHub returned an oversized release history response.')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('GitHub returned invalid release history data.')
  }
  if (!Array.isArray(parsed)) throw new Error('GitHub returned invalid release history data.')
  return {
    page,
    releases: parsed.map(releaseEntry).filter((entry): entry is AppReleaseHistoryEntry => Boolean(entry)),
    hasMore: NEXT_LINK_PATTERN.test(link ?? '')
  }
}

export class ReleaseHistoryService {
  readonly #fetch: ReleaseHistoryFetch
  readonly #now: () => number
  readonly #cacheTtlMs: number
  readonly #cache = new Map<number, CachedReleaseHistoryPage>()

  constructor(options: ReleaseHistoryServiceOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#now = options.now ?? Date.now
    this.#cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  }

  async getPage(page: number): Promise<AppReleaseHistoryPage> {
    if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
      throw new TypeError('Invalid release history page.')
    }
    const cached = this.#cache.get(page)
    if (cached && cached.expiresAt > this.#now()) return clonePage(cached.value)

    try {
      const response = await this.#fetch(
        `https://api.github.com/repos/hronaut/hronaut/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Hronaut release history'
          },
          signal: AbortSignal.timeout(10_000)
        }
      )
      if (!response.ok) throw new Error(`GitHub release history request failed with status ${response.status}.`)
      const contentLength = Number(response.headers.get('content-length') ?? '0')
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_LENGTH) {
        throw new Error('GitHub returned an oversized release history response.')
      }
      const value = parseReleaseHistoryPage(page, await response.text(), response.headers.get('link'))
      this.#cache.set(page, { expiresAt: this.#now() + this.#cacheTtlMs, value })
      return clonePage(value)
    } catch (error) {
      if (cached) return clonePage(cached.value)
      throw new Error('Could not load release history from GitHub.', { cause: error })
    }
  }
}
