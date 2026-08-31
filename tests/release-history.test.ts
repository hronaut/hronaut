import { describe, expect, it, vi } from 'vitest'
import { ReleaseHistoryService } from '../src/main/release-history.js'

function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.11.4',
    name: 'Hronaut 1.11.4',
    published_at: '2026-08-31T14:19:08Z',
    body: '### Fixed\n\n- Kept wallet actions reliable.',
    draft: false,
    prerelease: false,
    ...overrides
  }
}

describe('ReleaseHistoryService', () => {
  it('returns bounded stable GitHub releases with canonical links and pagination', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify([
      release(),
      release({ tag_name: 'v1.11.3', name: '', published_at: '2026-08-31T13:05:00Z' }),
      release({ tag_name: 'v1.12.0-beta.1', prerelease: true }),
      release({ tag_name: '../unsafe' }),
      { malformed: true }
    ]), {
      headers: { link: '<https://api.github.com/repositories/1/releases?per_page=10&page=2>; rel="next"' }
    }))
    const service = new ReleaseHistoryService({ fetch: fetch as typeof globalThis.fetch })

    await expect(service.getPage(1)).resolves.toEqual({
      page: 1,
      hasMore: true,
      releases: [
        expect.objectContaining({
          version: '1.11.4',
          title: 'Hronaut 1.11.4',
          url: 'https://github.com/hronaut/hronaut/releases/tag/v1.11.4'
        }),
        expect.objectContaining({ version: '1.11.3', title: 'Hronaut 1.11.3' })
      ]
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/hronaut/hronaut/releases?per_page=10&page=1',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/vnd.github+json' }) })
    )
  })

  it('uses a fresh cache and falls back to stale cached history when GitHub is unavailable', async () => {
    let now = 10
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([release()])))
      .mockRejectedValueOnce(new Error('offline'))
    const service = new ReleaseHistoryService({
      fetch: fetch as typeof globalThis.fetch,
      now: () => now,
      cacheTtlMs: 100
    })

    const first = await service.getPage(1)
    first.releases[0]!.title = 'mutated caller copy'
    expect((await service.getPage(1)).releases[0]!.title).toBe('Hronaut 1.11.4')
    expect(fetch).toHaveBeenCalledOnce()

    now = 111
    expect((await service.getPage(1)).releases[0]!.title).toBe('Hronaut 1.11.4')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('fails closed for invalid pages and untrusted response shapes', async () => {
    const fetch = vi.fn(async () => new Response('{"message":"rate limited"}', { status: 200 }))
    const service = new ReleaseHistoryService({ fetch: fetch as typeof globalThis.fetch })

    await expect(service.getPage(0)).rejects.toThrow('Invalid release history page')
    await expect(service.getPage(21)).rejects.toThrow('Invalid release history page')
    await expect(service.getPage(1)).rejects.toThrow('Could not load release history from GitHub')
  })
})
