import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HistoryStore, normalizeHistoryUrl } from '../src/main/history-store.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function storeAt(now = Date.UTC(2026, 7, 13)): Promise<{ path: string; store: HistoryStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-history-'))
  directories.push(directory)
  const path = join(directory, 'history.json')
  return { path, store: new HistoryStore(path, () => now) }
}

describe('HistoryStore', () => {
  it('keeps complete Unicode characters when recording and updating bounded titles', async () => {
    const { path, store } = await storeAt()
    const url = 'https://unicode.example/'
    const prefix = 'T'.repeat(199)
    expect((await store.record({ url, title: `${prefix}🧪` }))!.title).toBe(prefix)
    const exactTitle = `${'T'.repeat(198)}🧪`
    expect((await store.updateTitle({ url, title: exactTitle }))!.title).toBe(exactTitle)
    expect((await store.updateTitle({ url, title: `${prefix}🚀` }))!.title).toBe(prefix)
    expect((await new HistoryStore(path, () => Date.UTC(2026, 7, 13)).load())[0]!.title).toBe(prefix)
  })

  it('repairs titles previously saved with a split Unicode character', async () => {
    const { path, store } = await storeAt()
    const prefix = 'T'.repeat(199)
    await writeFile(path, JSON.stringify({ version: 1, entries: [{
      id: 'split-title', url: 'https://unicode.example/', title: `${prefix}\ud83e`,
      visitedAt: new Date(Date.UTC(2026, 7, 13)).toISOString(), visitCount: 2
    }] }))
    expect((await store.load())[0]!.title).toBe(prefix)
    expect(JSON.parse(await readFile(path, 'utf8')).entries[0].title).toBe(prefix)
  })

  it('ignores a history file containing JSON null', async () => {
    const { path, store } = await storeAt()
    await writeFile(path, 'null\n', 'utf8')

    await expect(store.load()).resolves.toEqual([])
  })

  it('normalizes safe web addresses and removes credentials and fragments', () => {
    expect(normalizeHistoryUrl('https://user:secret@example.com/path?q=1#private')).toBe('https://example.com/path?q=1')
    expect(normalizeHistoryUrl('hronaut://home/')).toBeNull()
    expect(normalizeHistoryUrl('data:text/plain,secret')).toBeNull()
  })

  it('records a visited page even when its discarded fragment exceeds the stored URL limit', async () => {
    const { path, store } = await storeAt()
    const pageUrl = 'https://fragment.example/page?view=one'
    const visitedUrl = `${pageUrl}#${'section'.repeat(800)}`

    expect(await store.record({ url: visitedUrl, title: 'Fragment page' })).toMatchObject({ url: pageUrl })
    expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual([
      expect.objectContaining({ url: pageUrl, title: 'Fragment page' })
    ])
    expect(await new HistoryStore(path, () => Date.UTC(2026, 7, 13)).load()).toEqual(store.list())
    expect(normalizeHistoryUrl(`https://fragment.example/page?q=${'x'.repeat(4_096)}`)).toBeNull()
  })

  it('rejects addresses that expand past the stored URL limit after encoding', () => {
    const rawUrl = `https://unicode.example/${'é'.repeat(1_400)}`
    expect(rawUrl.length).toBeLessThan(4_096)
    expect(normalizeHistoryUrl(rawUrl)).toBeNull()
  })

  it('persists visits, deduplicates addresses, and increments visit counts', async () => {
    const { path, store } = await storeAt()
    await store.record({ url: 'https://example.com/page#first', title: ' First   title ' })
    await store.record({ url: 'https://example.com/page#second', title: 'Updated title' })
    expect(store.list()).toEqual([
      expect.objectContaining({ url: 'https://example.com/page', title: 'Updated title', visitCount: 2 })
    ])
    const restored = new HistoryStore(path, () => Date.UTC(2026, 7, 13))
    await restored.load()
    expect(restored.list()).toEqual(store.list())
  })

  it('updates a recorded page title without counting another visit', async () => {
    const { path, store } = await storeAt()
    await store.record({ url: 'https://example.com/dashboard#loading', title: 'Loading account' })

    await expect(store.updateTitle({
      url: 'https://example.com/dashboard#ready',
      title: 'Account dashboard'
    })).resolves.toMatchObject({ title: 'Account dashboard', visitCount: 1 })

    expect(store.list()).toEqual([
      expect.objectContaining({
        url: 'https://example.com/dashboard',
        title: 'Account dashboard',
        visitCount: 1
      })
    ])
    const restored = new HistoryStore(path, () => Date.UTC(2026, 7, 13))
    await restored.load()
    expect(restored.list()).toEqual(store.list())
  })

  it('lets shutdown wait for already-queued history writes', async () => {
    const { path, store } = await storeAt()
    const recording = store.record({
      url: 'https://shutdown-history.example/last-visit',
      title: 'Last visit before shutdown'
    })

    await store.flush()

    expect(await recording).toMatchObject({ title: 'Last visit before shutdown' })
    expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual([
      expect.objectContaining({
        url: 'https://shutdown-history.example/last-visit',
        title: 'Last visit before shutdown'
      })
    ])
  })

  it('does not persist embedded HTTP credentials from a URL fallback title', async () => {
    const { path, store } = await storeAt()
    const privateUrl = 'https://person:history-secret@example.com/private#fragment'

    const recorded = await store.record({ url: privateUrl, title: privateUrl })

    expect(recorded).toMatchObject({
      url: 'https://example.com/private',
      title: 'https://example.com/private'
    })
    expect(await readFile(path, 'utf8')).not.toContain('history-secret')
  })

  it('does not persist a URL fragment from a fallback history title', async () => {
    const { path, store } = await storeAt()
    const privateUrl = 'https://fragment.example/page#private-fragment-token'

    expect(await store.record({ url: privateUrl, title: privateUrl })).toMatchObject({
      url: 'https://fragment.example/page',
      title: 'https://fragment.example/page'
    })
    expect(await readFile(path, 'utf8')).not.toContain('private-fragment-token')
  })

  it('repairs a legacy fallback title truncated inside a URL fragment', async () => {
    const now = Date.UTC(2026, 7, 13)
    const { path, store } = await storeAt(now)
    const privateUrl = `https://fragment.example/page#${'legacy-fragment-token-'.repeat(12)}`
    await writeFile(path, JSON.stringify({
      version: 1,
      entries: [{
        id: 'truncated-fragment', url: privateUrl, title: privateUrl.slice(0, 200),
        visitedAt: new Date(now - 1_000).toISOString(), visitCount: 1
      }]
    }), 'utf8')

    expect(await store.load()).toEqual([expect.objectContaining({
      url: 'https://fragment.example/page',
      title: 'https://fragment.example/page'
    })])
    expect(await readFile(path, 'utf8')).not.toContain('legacy-fragment-token')
  })

  it('repairs credential-bearing persisted history URLs and matching fallback titles', async () => {
    const now = Date.UTC(2026, 7, 13)
    const { path, store } = await storeAt(now)
    const privateUrl = 'https://person:old-history-secret@example.com/private#fragment'
    await writeFile(path, JSON.stringify({
      version: 1,
      entries: [{
        id: 'private-history',
        url: privateUrl,
        title: privateUrl,
        visitedAt: new Date(now - 1_000).toISOString(),
        visitCount: 1
      }]
    }), 'utf8')

    expect(await store.load()).toEqual([expect.objectContaining({
      id: 'private-history',
      url: 'https://example.com/private',
      title: 'https://example.com/private'
    })])
    expect(await readFile(path, 'utf8')).not.toContain('old-history-secret')
  })

  it('repairs legacy URL fallback titles truncated inside embedded credentials', async () => {
    const now = Date.UTC(2026, 7, 13)
    const { path, store } = await storeAt(now)
    const privateUrl = `https://person:${'legacy-history-secret-'.repeat(16)}@example.com/private`
    await writeFile(path, JSON.stringify({
      version: 1,
      entries: [{
        id: 'truncated-private-history',
        url: privateUrl,
        title: privateUrl.slice(0, 200),
        visitedAt: new Date(now - 1_000).toISOString(),
        visitCount: 1
      }]
    }), 'utf8')

    expect(await store.load()).toEqual([expect.objectContaining({
      id: 'truncated-private-history',
      url: 'https://example.com/private',
      title: 'https://example.com/private'
    })])
    expect(await readFile(path, 'utf8')).not.toContain('legacy-history-secret')
  })

  it('supports individual removal and clearing without touching another store', async () => {
    const { path, store } = await storeAt()
    const first = await store.record({ url: 'https://one.example/', title: 'One' })
    await store.record({ url: 'https://two.example/', title: 'Two' })
    expect(first).not.toBeNull()
    await store.remove(first!.id)
    expect(store.list()).toHaveLength(1)
    await store.clear()
    expect(store.list()).toEqual([])
    expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual([])
  })

  it('clears history for one exact website origin', async () => {
    const { store } = await storeAt()
    await store.record({ url: 'https://example.com/one', title: 'One' })
    await store.record({ url: 'https://example.com/two', title: 'Two' })
    await store.record({ url: 'https://other.example.com/', title: 'Other' })
    await store.record({ url: 'http://example.com/', title: 'Different scheme' })

    expect(await store.clearOrigin('https://example.com')).toBe(2)
    expect(store.list().map((entry) => entry.url).sort()).toEqual([
      'http://example.com/',
      'https://other.example.com/'
    ])
  })

  it('drops expired, malformed, unsafe, and duplicate persisted entries', async () => {
    const now = Date.UTC(2026, 7, 13)
    const { path, store } = await storeAt(now)
    const recent = new Date(now - 1_000).toISOString()
    const expired = new Date(now - 91 * 24 * 60 * 60 * 1_000).toISOString()
    await writeFile(path, JSON.stringify({
      version: 1,
      entries: [
        { id: 'new', url: 'https://example.com/', title: 'New', visitedAt: recent, visitCount: 2 },
        { id: 'duplicate', url: 'https://example.com/', title: 'Duplicate', visitedAt: recent, visitCount: 1 },
        { id: 'old', url: 'https://old.example/', title: 'Old', visitedAt: expired, visitCount: 1 },
        { id: 'unsafe', url: 'file:///secret', title: 'Unsafe', visitedAt: recent, visitCount: 1 },
        { broken: true }
      ]
    }))
    await store.load()
    expect(store.list()).toEqual([expect.objectContaining({ id: 'new' })])
    expect((JSON.parse(await readFile(path, 'utf8')) as { entries: Array<{ id: string }> }).entries)
      .toEqual([expect.objectContaining({ id: 'new' })])
  })

  it('repairs future visit timestamps without discarding the history entry', async () => {
    const now = Date.UTC(2026, 7, 13)
    const { path, store } = await storeAt(now)
    const future = new Date(now + 24 * 60 * 60 * 1_000).toISOString()
    await writeFile(path, JSON.stringify({
      version: 1,
      entries: [{
        id: 'future-visit',
        url: 'https://clock-skew.example/',
        title: 'Clock skew',
        visitedAt: future,
        visitCount: 1
      }]
    }))

    expect(await store.load()).toEqual([expect.objectContaining({
      id: 'future-visit',
      visitedAt: new Date(now).toISOString()
    })])
    expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual([
      expect.objectContaining({
        id: 'future-visit',
        visitedAt: new Date(now).toISOString()
      })
    ])
  })

  it('orders restored visits by time when persisted timestamps have different offsets', async () => {
    const { path, store } = await storeAt(Date.UTC(2026, 7, 13, 12))
    await writeFile(path, JSON.stringify({
      version: 1,
      entries: [
        {
          id: 'earlier', url: 'https://earlier.example/', title: 'Earlier',
          visitedAt: '2026-08-13T10:00:00+10:00', visitCount: 1
        },
        {
          id: 'later', url: 'https://later.example/', title: 'Later',
          visitedAt: '2026-08-13T01:00:00Z', visitCount: 1
        }
      ]
    }))

    expect((await store.load()).map((entry) => entry.id)).toEqual(['later', 'earlier'])
    expect(store.list().map((entry) => entry.visitedAt)).toEqual([
      '2026-08-13T01:00:00.000Z',
      '2026-08-13T00:00:00.000Z'
    ])
    expect(JSON.parse(await readFile(path, 'utf8')).entries.map((entry: { visitedAt: string }) => entry.visitedAt)).toEqual([
      '2026-08-13T01:00:00.000Z',
      '2026-08-13T00:00:00.000Z'
    ])
  })

  it('repairs duplicate persisted IDs without dropping distinct history entries', async () => {
    const now = Date.UTC(2026, 7, 13)
    const { path, store } = await storeAt(now)
    const visitedAt = new Date(now - 1_000).toISOString()
    await writeFile(path, JSON.stringify({
      version: 1,
      entries: [
        { id: 'duplicate-id', url: 'https://one.example/', title: 'One', visitedAt, visitCount: 1 },
        { id: 'duplicate-id', url: 'https://two.example/', title: 'Two', visitedAt, visitCount: 1 }
      ]
    }))

    const restored = await store.load()
    expect(restored).toHaveLength(2)
    expect(new Set(restored.map((entry) => entry.id)).size).toBe(2)
    expect(new Set((JSON.parse(await readFile(path, 'utf8')) as { entries: Array<{ id: string }> }).entries.map((entry) => entry.id)).size).toBe(2)
  })

  it('keeps history unchanged when mutations cannot be persisted', async () => {
    const { path, store } = await storeAt()
    const first = await store.record({ url: 'https://one.example/', title: 'One' })
    await store.record({ url: 'https://two.example/', title: 'Two' })
    const before = store.list()
    expect(first).not.toBeNull()
    const backupPath = `${path}.backup`
    await rename(path, backupPath)
    await mkdir(path)

    await expect(store.record({ url: 'https://three.example/', title: 'Lost visit' })).rejects.toThrow()
    expect(store.list()).toEqual(before)
    await expect(store.remove(first!.id)).rejects.toThrow()
    expect(store.list()).toEqual(before)
    await expect(store.clearOrigin('https://one.example')).rejects.toThrow()
    expect(store.list()).toEqual(before)
    await expect(store.clear()).rejects.toThrow()
    expect(store.list()).toEqual(before)

    await rm(path, { recursive: true })
    await rename(backupPath, path)
    const restored = new HistoryStore(path, () => Date.UTC(2026, 7, 13))
    expect(await restored.load()).toEqual(before)
  })
})
