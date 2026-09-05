import { describe, expect, it, vi } from 'vitest'
import { generateReleaseHistory } from '../scripts/release-history.js'

const release = (version: string, extra: object = {}) => ({ tag_name: `v${version}`, name: `Hronaut ${version}`, html_url: `https://github.com/hronaut/hronaut/releases/tag/v${version}`, published_at: '2026-09-01T12:00:00Z', body: '### Fixed\n- A fix.', draft: false, prerelease: false, ...extra })
const generate = (payload: unknown, notes = '### Fixed\n- Reliable releases.') => generateReleaseHistory('1.11.55', notes, { fetcher: vi.fn(async () => Response.json(payload)) as unknown as typeof fetch, generatedAt: new Date('2026-09-05T00:00:00Z') })

describe('published release history artifact', () => {
  it('includes complete published history and a truthful prepared candidate without a publication date', async () => {
    const artifact = await generate([release('1.11.51'), release('1.11.53', { draft: true }), release('1.11.52', { prerelease: true })])
    expect(artifact).toMatchObject({ schemaVersion: 1, tag: 'v1.11.55', generatedAt: '2026-09-05T00:00:00.000Z' })
    expect(artifact.releases.map(x => x.version)).toEqual(['1.11.55', '1.11.51'])
    expect(artifact.releases[0]?.publishedAt).toBeNull()
    expect(artifact.releases[1]?.publishedAt).toBe('2026-09-01T12:00:00.000Z')
  })

  it('continues full upstream pages until exhaustion using the workflow token only in request headers', async () => {
    const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => Response.json(String(url).endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => release(`1.0.${i}`)) : [release('0.9.1')])) as unknown as typeof fetch
    const artifact = await generateReleaseHistory('1.11.55', 'Notes', { fetcher, token: 'test-workflow-token' })
    expect(artifact.releases).toHaveLength(102)
    expect(artifact.releases.at(-1)?.version).toBe('0.9.1')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining('page=2'), expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer test-workflow-token' }) }))
    expect(JSON.stringify(artifact)).not.toContain('test-workflow-token')
  })

  it.each([
    ['duplicate', [release('1.11.51'), release('1.11.51')]],
    ['already published candidate', [release('1.11.55')]],
    ['foreign URL', [release('1.11.51', { html_url: 'https://evil.example/release' })]],
    ['invalid publication', [release('1.11.51', { published_at: null })]],
    ['unexpected payload', { message: 'upstream failed' }]
  ])('rejects %s instead of publishing partial history', async (_name, payload) => {
    await expect(generate(payload)).rejects.toThrow()
  })

  it('bounds notes and removes HTML/control content for both prepared and prior entries', async () => {
    const artifact = await generate([release('1.11.51', { body: '<script>secret()</script>\u0000Safe' })], 'x'.repeat(60_000))
    expect(Buffer.byteLength(JSON.stringify(artifact.releases[0]?.notes))).toBeLessThanOrEqual(16 * 1024)
    expect(artifact.releases[0]?.notes).toMatch(/…$/u)
    expect(artifact.releases[1]?.notes).toBe('Safe')
  })

  it('fails the candidate when a later upstream page is unavailable', async () => {
    const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => String(url).endsWith('page=1') ? Response.json(Array.from({ length: 100 }, (_, i) => release(`1.0.${i}`))) : new Response('rate limited', { status: 403 })) as unknown as typeof fetch
    await expect(generateReleaseHistory('1.11.55', 'Notes', { fetcher })).rejects.toThrow('403')
  })

  it('retains the newest 200 entries and routes older history to GitHub without blocking publication', async () => {
    const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => Response.json(Array.from({ length: 100 }, (_, i) => release(`1.${String(url).endsWith('page=1') ? 0 : 1}.${i}`)))) as unknown as typeof fetch
    const artifact = await generateReleaseHistory('1.11.55', 'Notes', { fetcher })
    expect(artifact.releases).toHaveLength(200)
    expect(artifact.releases[0]?.version).toBe('1.11.55')
    expect(artifact.releases.at(-1)?.version).toBe('1.1.98')
    expect(artifact).toMatchObject({ truncated: true, olderHistoryUrl: 'https://github.com/hronaut/hronaut/releases' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('retains 200 long multibyte and escaped notes within the encoded byte budget', async () => {
    const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => Response.json(Array.from({ length: String(url).endsWith('page=1') ? 100 : 99 }, (_, i) => release(`1.${String(url).endsWith('page=1') ? 0 : 1}.${i}`, { body: '😀"\\'.repeat(14_000) })))) as unknown as typeof fetch
    const artifact = await generateReleaseHistory('1.11.55', '😀"\\'.repeat(14_000), { fetcher })
    expect(artifact.releases).toHaveLength(200)
    expect(artifact.truncated).toBe(false)
    for (const entry of artifact.releases) {
      expect(Buffer.byteLength(JSON.stringify(entry.notes))).toBeLessThanOrEqual(16 * 1024)
      expect(entry.notes).toMatch(/…$/u)
      expect(entry.notes).not.toMatch(/\p{Surrogate}/u)
    }
    expect(Buffer.byteLength(JSON.stringify(artifact)) + 1).toBeLessThanOrEqual(4 * 1024 * 1024)
  })

  it('rejects oversized upstream data before JSON parsing even without a length header', async () => {
    const fetcher = vi.fn(async () => new Response('x'.repeat(20 * 1024 * 1024 + 1))) as unknown as typeof fetch
    await expect(generateReleaseHistory('1.11.55', 'Notes', { fetcher })).rejects.toThrow('20 MiB')
  })

  it('does not fetch another page once the retained-entry cap is reached', async () => {
    const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      if (String(url).endsWith('page=1')) return Response.json(Array.from({ length: 100 }, (_, i) => release(`1.0.${i}`)))
      if (String(url).endsWith('page=2')) return Response.json([...Array.from({ length: 99 }, (_, i) => release(`1.1.${i}`)), release('1.2.0', { draft: true })])
      return new Response('unavailable older page', { status: 503 })
    }) as unknown as typeof fetch
    const artifact = await generateReleaseHistory('1.11.55', 'Notes', { fetcher })
    expect(artifact.releases).toHaveLength(200)
    expect(artifact.truncated).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('reports complete history when exactly 200 retained records exhaust upstream history', async () => {
    const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => Response.json(Array.from({ length: String(url).endsWith('page=1') ? 100 : 99 }, (_, i) => release(`1.${String(url).endsWith('page=1') ? 0 : 1}.${i}`)))) as unknown as typeof fetch
    const artifact = await generateReleaseHistory('1.11.55', 'Notes', { fetcher })
    expect(artifact.releases).toHaveLength(200)
    expect(artifact.truncated).toBe(false)
    expect(artifact.olderHistoryUrl).toBeUndefined()
  })
})
