import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  it('keeps blank-title visits on long hostnames reloadable after recording and title updates', async () => {
    const now = Date.UTC(2026, 7, 13)
    const { path, store } = await storeAt(now)
    const hostname = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(40)}.test`
    const url = `https://${hostname}/`
    const saved = await store.record({ url, title: '   ' })
    expect(saved!.title).toBe(hostname.slice(0, 200))
    await store.flush()
    await expect(new HistoryStore(path, () => now).load()).resolves.toEqual([saved])

    await store.updateTitle({ url, title: 'Explicit title' })
    const updated = await store.updateTitle({ url, title: '' })
    expect(updated!.title).toBe(hostname.slice(0, 200))
    await store.flush()
    await expect(new HistoryStore(path, () => now).load()).resolves.toEqual([updated])
  })

  it('keeps complete Unicode characters when recording and updating bounded titles', async () => {
    const { path, store } = await storeAt()
    const url = 'https://unicode.example/'
    const prefix = 'T'.repeat(199)
    expect((await store.record({ url, title: `${prefix}🧪` }))!.title).toBe(prefix)
    const exactTitle = `${'T'.repeat(198)}🧪`
    expect((await store.updateTitle({ url, title: exactTitle }))!.title).toBe(exactTitle)
    expect((await store.updateTitle({ url, title: `${prefix}🚀` }))!.title).toBe(prefix)
    await store.flush()
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
    await store.flush()
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

  it('records an address whose long credentials are discarded before storage', async () => {
    const { path, store } = await storeAt()
    const privateUrl = `https://person:${'private-credential-'.repeat(230)}@example.com/page`

    expect(privateUrl.length).toBeGreaterThan(4_096)
    expect(await store.record({ url: privateUrl, title: 'Account page' })).toMatchObject({
      url: 'https://example.com/page', title: 'Account page'
    })
    await store.flush()
    expect(await readFile(path, 'utf8')).not.toContain('private-credential')
  })

  it('persists visits, deduplicates addresses, and increments visit counts', async () => {
    const { path, store } = await storeAt()
    await store.record({ url: 'https://example.com/page#first', title: ' First   title ' })
    await store.record({ url: 'https://example.com/page#second', title: 'Updated title' })
    expect(store.list()).toEqual([
      expect.objectContaining({ url: 'https://example.com/page', title: 'Updated title', visitCount: 2 })
    ])
    await store.flush()
    const restored = new HistoryStore(path, () => Date.UTC(2026, 7, 13))
    await restored.load()
    expect(restored.list()).toEqual(store.list())
  })

  it('stops showing a visit after 90 days even when the browser stays open', async () => {
    let now = Date.UTC(2026, 0, 1)
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-history-'))
    directories.push(directory)
    const store = new HistoryStore(join(directory, 'history.json'), () => now)
    await store.record({ url: 'https://expired.example/', title: 'Old visit' })

    now += 91 * 24 * 60 * 60 * 1_000

    expect(store.list()).toEqual([])
    await store.pruneExpired()
    expect(JSON.parse(await readFile(join(directory, 'history.json'), 'utf8')).entries).toEqual([])
  })

  it('starts a fresh visit count when an expired page is visited again', async () => {
    let now = Date.UTC(2026, 0, 1)
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-history-'))
    directories.push(directory)
    const store = new HistoryStore(join(directory, 'history.json'), () => now)
    await store.record({ url: 'https://return.example/', title: 'First visit' })

    now += 91 * 24 * 60 * 60 * 1_000

    expect(await store.record({ url: 'https://return.example/', title: 'New visit' })).toMatchObject({ visitCount: 1 })
  })

  it('removes expired visits from disk and publishes the change while the app stays open', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(Date.UTC(2026, 0, 1))
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-history-'))
    directories.push(directory)
    const path = join(directory, 'history.json')
    const onExpired = vi.fn()
    const store = new HistoryStore(path, Date.now, onExpired)
    try {
      await store.record({ url: 'https://retained.example/', title: 'Retained visit' })

      await vi.advanceTimersByTimeAsync(90 * 24 * 60 * 60 * 1_000 + 1)
      await store.flush()

      expect(store.list()).toEqual([])
      expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual([])
      expect(onExpired).toHaveBeenCalledTimes(1)
    } finally {
      store.dispose()
      vi.useRealTimers()
    }
  })

  it('retries automatic expiry after a disk failure without publishing an unsaved change', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(Date.UTC(2026, 0, 1))
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-history-'))
    directories.push(directory)
    const path = join(directory, 'history.json')
    const onExpired = vi.fn()
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const errorReported = new Promise<void>((resolve) => {
      reportError.mockImplementation(() => resolve())
    })
    const store = new HistoryStore(path, Date.now, onExpired)
    try {
      await store.record({ url: 'https://retained.example/', title: 'Retained visit' })
      await store.flush()
      const saved = await readFile(path, 'utf8')
      await rename(path, `${path}.backup`)
      await mkdir(path)

      await vi.advanceTimersByTimeAsync(90 * 24 * 60 * 60 * 1_000 + 1)
      await store.flush()
      await errorReported
      expect(reportError).toHaveBeenCalledTimes(1)
      expect(onExpired).not.toHaveBeenCalled()
      expect(await readFile(`${path}.backup`, 'utf8')).toBe(saved)

      await rm(path, { recursive: true })
      await rename(`${path}.backup`, path)
      await vi.advanceTimersByTimeAsync(59_999)
      expect(await readFile(path, 'utf8')).toBe(saved)
      await vi.advanceTimersByTimeAsync(1)
      await store.flush()
      expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual([])
      expect(onExpired).toHaveBeenCalledTimes(1)
    } finally {
      store.dispose()
      reportError.mockRestore()
      vi.useRealTimers()
    }
  })

  it('cancels automatic expiry when the store is disposed', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(Date.UTC(2026, 0, 1))
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-history-'))
    directories.push(directory)
    const path = join(directory, 'history.json')
    const onExpired = vi.fn()
    const store = new HistoryStore(path, Date.now, onExpired)
    try {
      await store.record({ url: 'https://retained.example/', title: 'Retained visit' })
      await store.flush()
      const saved = await readFile(path, 'utf8')
      store.dispose()
      await vi.advanceTimersByTimeAsync(91 * 24 * 60 * 60 * 1_000)
      await store.flush()
      expect(await readFile(path, 'utf8')).toBe(saved)
      expect(onExpired).not.toHaveBeenCalled()
    } finally {
      store.dispose()
      vi.useRealTimers()
    }
  })

  it('caps restored and newly recorded visit counts at the safe integer limit', async () => {
    const now = Date.UTC(2026, 7, 13)
    const { path, store } = await storeAt(now)
    const url = 'https://frequent.example/'
    await writeFile(path, JSON.stringify({ version: 1, entries: [{
      id: 'frequent', url, title: 'Frequent page',
      visitedAt: new Date(now).toISOString(), visitCount: Number.MAX_SAFE_INTEGER + 1
    }] }), 'utf8')

    expect((await store.load())[0]?.visitCount).toBe(Number.MAX_SAFE_INTEGER)
    expect(JSON.parse(await readFile(path, 'utf8')).entries[0].visitCount).toBe(Number.MAX_SAFE_INTEGER)
    expect((await store.record({ url, title: 'Frequent page' }))?.visitCount).toBe(Number.MAX_SAFE_INTEGER)
    await store.flush()
    expect(JSON.parse(await readFile(path, 'utf8')).entries[0].visitCount).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('moves a page opened again to the top with its title, without counting another visit', async () => {
    // A reload counted a visit each time, so a page a developer reloaded 20 times showed "21 visits" and led the list.
    let now = Date.UTC(2026, 7, 13)
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-history-'))
    directories.push(directory)
    const path = join(directory, 'history.json')
    const store = new HistoryStore(path, () => now)
    await store.record({ url: 'https://example.com/dashboard', title: 'Dashboard' })
    now += 60_000
    await store.record({ url: 'https://example.com/other', title: 'Other' })
    now += 60_000

    await expect(store.record({ url: 'https://example.com/dashboard', title: 'Dashboard, 3 alerts', samePage: true }))
      .resolves.toMatchObject({ title: 'Dashboard, 3 alerts', visitCount: 1, visitedAt: new Date(now).toISOString() })
    expect(store.list().map((entry) => [entry.url, entry.visitCount])).toEqual([
      ['https://example.com/dashboard', 1],
      ['https://example.com/other', 1]
    ])
    await store.flush()
    const restored = new HistoryStore(path, () => now)
    await restored.load()
    expect(restored.list()).toEqual(store.list())
  })

  it('counts a page opened again as a visit when the history no longer holds it', async () => {
    const { store } = await storeAt()
    await expect(store.record({ url: 'https://example.com/cleared', title: 'Cleared', samePage: true }))
      .resolves.toMatchObject({ visitCount: 1 })
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
    await store.flush()
    const restored = new HistoryStore(path, () => Date.UTC(2026, 7, 13))
    await restored.load()
    expect(restored.list()).toEqual(store.list())
  })

  it('saves the visits and new titles of a second together, without indenting the file', async () => {
    // Saving the whole history for each visit and title kept the main process writing while dozens of pages loaded.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { path, store } = await storeAt()
    try {
      await store.record({ url: 'https://one.example/', title: 'One' })
      await store.updateTitle({ url: 'https://one.example/', title: 'One, loaded' })
      await store.record({ url: 'https://two.example/', title: 'Two' })
      await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await vi.advanceTimersByTimeAsync(999)
      await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await vi.advanceTimersByTimeAsync(1)
      await store.flush()
      const saved = await readFile(path, 'utf8')
      expect(saved).toBe(`${JSON.stringify({ version: 1, entries: JSON.parse(saved).entries })}\n`)
      expect(JSON.parse(saved).entries.map((entry: { title: string }) => entry.title)).toEqual(['One, loaded', 'Two'])
    } finally {
      store.dispose()
      vi.useRealTimers()
    }
  })

  it('never saves a visit back after the history was cleared', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { path, store } = await storeAt()
    try {
      await store.record({ url: 'https://private.example/', title: 'Private' })
      await store.clear()
      await vi.advanceTimersByTimeAsync(1_000)
      await store.flush()
      expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual([])
    } finally {
      store.dispose()
      vi.useRealTimers()
    }
  })

  it('tells the windows only what visits and new titles changed since they last heard', async () => {
    const { store } = await storeAt()
    const one = await store.record({ url: 'https://one.example/', title: 'One' })
    const two = await store.record({ url: 'https://two.example/', title: 'Two' })
    expect(store.takeChanges()).toEqual({ entries: [one, two], removedIds: [] })
    expect(store.takeChanges()).toEqual({ entries: [], removedIds: [] })
    const retitled = await store.updateTitle({ url: 'https://one.example/', title: 'One, loaded' })
    expect(store.takeChanges()).toEqual({ entries: [retitled], removedIds: [] })
    // A page gone by the time the windows hear leaves their list.
    await store.record({ url: 'https://three.example/', title: 'Three' })
    const [three] = store.list().filter((entry) => entry.title === 'Three')
    await store.remove(three!.id)
    expect(store.takeChanges()).toEqual({ entries: [], removedIds: [three!.id] })
    await store.flush()
  })

  it('lets the oldest page go when a visit puts the history over its limit, and tells the windows', async () => {
    let now = Date.UTC(2026, 7, 13)
    const { path } = await storeAt()
    await writeFile(path, JSON.stringify({ version: 1, entries: Array.from({ length: 2_000 }, (_, index) => ({
      id: `page-${index}`, url: `https://page-${index}.example/`, title: `Page ${index}`,
      visitedAt: new Date(now - index * 1_000).toISOString(), visitCount: 1
    })) }), 'utf8')
    const store = new HistoryStore(path, () => now)
    await store.load()
    now += 1_000
    const added = await store.record({ url: 'https://new.example/', title: 'New' })
    expect(store.list()).toHaveLength(2_000)
    expect(store.list()[0]).toEqual(added)
    expect(store.list().some((entry) => entry.id === 'page-1999')).toBe(false)
    expect(store.takeChanges()).toEqual({ entries: [added], removedIds: ['page-1999'] })
    await store.flush()
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
    await store.flush()
    expect(await readFile(path, 'utf8')).not.toContain('history-secret')
  })

  it.each(['x'.repeat(4_096), 'x'.repeat(32_768)])('scrubs credentials from oversized URL titles (%#. boundary)', async (suffix) => {
    const { path, store } = await storeAt()
    const url = 'https://example.com/page'
    const title = `https://person:history-secret@example.com/${suffix}`

    expect(await store.record({ url, title })).toMatchObject({ url, title: url })
    await store.flush()
    expect(await readFile(path, 'utf8')).not.toContain('history-secret')
    await store.updateTitle({ url, title: 'Ordinary title' })
    expect(await store.updateTitle({ url, title })).toMatchObject({ title: url, visitCount: 1 })
    await store.flush()
    expect(await readFile(path, 'utf8')).not.toContain('history-secret')
  })

  it('does not persist a URL fragment from a fallback history title', async () => {
    const { path, store } = await storeAt()
    const privateUrl = 'https://fragment.example/page#private-fragment-token'

    expect(await store.record({ url: privateUrl, title: privateUrl })).toMatchObject({
      url: 'https://fragment.example/page',
      title: 'https://fragment.example/page'
    })
    await store.flush()
    expect(await readFile(path, 'utf8')).not.toContain('private-fragment-token')
  })

  it.each([
    // The first title is what Electron 44.9.0's webContents.getTitle() returned for an untitled page at that address,
    // probed under Xvfb; the others follow Chromium's address formatting for such titles. Chromium keeps the slash
    // of a bare host when a fragment follows it, and wraps an address with right-to-left text in U+202A … U+202C.
    ['http://127.0.0.1:3000/callback#access_token=history-secret', '127.0.0.1:3000/callback#access_token=history-secret', 'http://127.0.0.1:3000/callback'],
    ['https://app.example/oauth/callback#access_token=history-secret', 'app.example/oauth/callback#access_token=history-secret', 'https://app.example/oauth/callback'],
    ['https://www.example.com/cb?step=2#id_token=history-secret', 'example.com/cb?step=2#id_token=history-secret', 'https://www.example.com/cb?step=2'],
    ['https://docs.example/a%20b#key=history-secret', 'docs.example/a b#key=history-secret', 'https://docs.example/a%20b'],
    ['https://xn--e1afmkfd.example/#key=history-secret', 'пример.example/#key=history-secret', 'https://xn--e1afmkfd.example/'],
    [
      'https://app.example.co.il/cb#access_token=history-secret&state=%D7%A9%D7%9C%D7%95%D7%9D',
      '\u202Aapp.example.co.il/cb#access_token=history-secret&state=שלום\u202C',
      'https://app.example.co.il/cb'
    ]
  ])('does not save the fragment of the address Chromium shows as an untitled page\'s title (%s)', async (url, title, saved) => {
    // An untitled sign-in callback was saved with its fragment as the title, such as
    // app.example/oauth/callback#access_token=…, since Chromium leaves out the scheme there.
    const { path, store } = await storeAt()
    expect(await store.record({ url, title })).toMatchObject({ title: saved })
    await store.updateTitle({ url, title: 'Ordinary title' })
    expect(await store.updateTitle({ url, title })).toMatchObject({ title: saved })
    await store.flush()
    expect(await readFile(path, 'utf8')).not.toContain('history-secret')
  })

  it.each([
    // Chromium decodes escapes in the address it shows, and a tab's title composes Unicode and collapses whitespace.
    ['lowercase escapes', 'https://docs.example/caf%c3%a9#key=history-secret', 'docs.example/café#key=history-secret'],
    ['escaped unreserved characters in the query', 'https://docs.example/s?q=%7Euser%2Dx%41#key=history-secret', 'docs.example/s?q=~user-xA#key=history-secret'],
    ['repeated escaped spaces', 'https://docs.example/a%20%20b#key=history-secret', 'docs.example/a b#key=history-secret'],
    ['decomposed Unicode', 'https://docs.example/cafe%CC%81#key=history-secret', 'docs.example/caf\u00e9#key=history-secret'],
    ['an escaped space before the fragment', 'https://docs.example/a%20#key=history-secret', 'docs.example/a #key=history-secret'],
    ['the scheme kept', 'https://docs.example/caf%c3%a9#key=history-secret', 'https://docs.example/café#key=history-secret']
  ])('does not save the fragment of an untitled page\'s address shown with %s', async (_case, url, title) => {
    // These titles were the page's address too, but did not normalize to it exactly, so the token was saved.
    const { path, store } = await storeAt()
    const saved = normalizeHistoryUrl(url)
    expect(await store.record({ url, title })).toMatchObject({ title: saved })
    await store.flush()
    expect(await readFile(path, 'utf8')).not.toContain('history-secret')
  })

  it('keeps a real title that only looks like an address', async () => {
    const { store } = await storeAt()
    expect(await store.record({ url: 'https://app.example/dashboard', title: 'app.example/status' })).toMatchObject({ title: 'app.example/status' })
    expect(await store.record({ url: 'https://news.example/', title: 'news.example — Today' })).toMatchObject({ title: 'news.example — Today' })
    // A title without a fragment holds nothing the saved address leaves out, so a site named after its address keeps it.
    expect(await store.record({ url: 'https://www.booking.com/', title: 'Booking.com' })).toMatchObject({ title: 'Booking.com' })
    expect(await store.record({ url: 'http://localhost:3000/', title: 'localhost:3000' })).toMatchObject({ title: 'localhost:3000' })
    expect(await store.record({ url: 'https://docs.example/guide', title: 'Guide #3 · docs.example/guide#intro' })).toMatchObject({
      title: 'Guide #3 · docs.example/guide#intro'
    })
  })

  it('repairs a saved untitled page\'s title that kept a fragment without its scheme', async () => {
    const now = Date.UTC(2026, 7, 13)
    const { path, store } = await storeAt(now)
    await writeFile(path, JSON.stringify({
      version: 1,
      entries: [{
        id: 'callback', url: 'https://app.example/oauth/callback', title: 'app.example/oauth/callback#access_token=history-secret',
        visitedAt: new Date(now - 1_000).toISOString(), visitCount: 1
      }]
    }), 'utf8')

    expect(await store.load()).toEqual([expect.objectContaining({ title: 'https://app.example/oauth/callback' })])
    expect(await readFile(path, 'utf8')).not.toContain('history-secret')
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

  it('repairs legacy URL fallback titles even when their stored URLs already lost the fragment', async () => {
    const now = Date.UTC(2026, 7, 13)
    const { path, store } = await storeAt(now)
    const url = 'https://fragment.example/page'
    const fragmentTitle = `${url}#private-fragment-token`
    const truncatedTitle = `${url}#${'long-private-fragment-'.repeat(12)}`.slice(0, 200)
    await writeFile(path, JSON.stringify({
      version: 1,
      entries: [
        { id: 'full', url, title: fragmentTitle, visitedAt: new Date(now).toISOString(), visitCount: 1 },
        { id: 'truncated', url: `${url}/second`, title: truncatedTitle.replace(url, `${url}/second`).slice(0, 200), visitedAt: new Date(now - 1).toISOString(), visitCount: 1 }
      ]
    }), 'utf8')

    expect(await store.load()).toEqual([
      expect.objectContaining({ id: 'full', title: url }),
      expect.objectContaining({ id: 'truncated', title: `${url}/second` })
    ])
    expect(await readFile(path, 'utf8')).not.toContain('private-fragment')
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
    // Removing names the page that left, which Recently closed forgets with it; an id already gone names none.
    await expect(store.remove(first!.id)).resolves.toEqual(first)
    await expect(store.remove(first!.id)).resolves.toBeNull()
    expect(store.list()).toHaveLength(1)
    await store.clear()
    expect(store.list()).toEqual([])
    expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual([])
  })

  // Clear history wrote nothing when it listed no visits, so a history file Hronaut could not read kept its visits on
  // disk though the Privacy page said the history was cleared.
  it.each([
    ['a newer version', JSON.stringify({ version: 2, entries: [{ id: 'a', url: 'https://private.example/visit', title: 'Private', visitedAt: '2026-08-12T00:00:00.000Z', visitCount: 1 }] })],
    ['a cut-short file', '{"version":1,"entries":[{"id":"a","url":"https://private.example/visit","title":"Private"']
  ])('removes the visits of %s it could not read when clearing', async (_name, contents) => {
    const { path, store } = await storeAt()
    await writeFile(path, contents)
    await expect(store.load()).resolves.toEqual([])
    await store.clear()
    expect(await readFile(path, 'utf8')).not.toContain('private.example')
    expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual([])
  })

  it('removes the visits of a file it could not read when clearing one website', async () => {
    const { path, store } = await storeAt()
    await writeFile(path, JSON.stringify({ version: 2, entries: [{ id: 'a', url: 'https://private.example/visit', title: 'Private', visitedAt: '2026-08-12T00:00:00.000Z', visitCount: 1 }] }))
    await expect(store.load()).resolves.toEqual([])
    await expect(store.clearOrigin('https://private.example')).resolves.toBe(0)
    expect(await readFile(path, 'utf8')).not.toContain('private.example')
  })

  // As Chrome's Delete browsing data, clearing the last hour leaves the visits before it.
  it('clears the visits within a time range, and keeps the visits of a page from before it', async () => {
    const hour = 60 * 60 * 1000
    let now = Date.UTC(2026, 7, 13, 12)
    const { path } = await storeAt()
    const clock = new HistoryStore(path, () => now)
    await clock.load()
    await clock.record({ url: 'https://old.example/', title: 'Old' })
    await clock.record({ url: 'https://both.example/', title: 'Both' })
    now += hour
    await clock.record({ url: 'https://both.example/', title: 'Both' })
    const lastVisitBefore = new Date(now).toISOString()
    now += hour
    await clock.record({ url: 'https://edge.example/', title: 'Edge' })
    now += hour
    await clock.record({ url: 'https://recent.example/page#part', title: 'Recent' })
    // Visited twice before the hour and twice within it, the page was cleared only of the two visits within it.
    await clock.record({ url: 'https://both.example/', title: 'Both again' })
    await clock.record({ url: 'https://both.example/', title: 'Both again' })
    await expect(clock.clearSince(now - hour)).resolves.toEqual(expect.arrayContaining(['https://edge.example/', 'https://recent.example/page', 'https://both.example/']))
    expect(clock.list()).toEqual([
      { id: expect.any(String), url: 'https://both.example/', title: 'Both again', visitedAt: lastVisitBefore, visitCount: 2 },
      { id: expect.any(String), url: 'https://old.example/', title: 'Old', visitedAt: new Date(Date.UTC(2026, 7, 13, 12)).toISOString(), visitCount: 1 }
    ])
    const saved = JSON.parse(await readFile(path, 'utf8')).entries as Array<{ url: string; recentVisits?: number[] }>
    expect(saved.map((entry) => [entry.url, entry.recentVisits])).toEqual([
      ['https://both.example/', [Date.UTC(2026, 7, 13, 12), Date.UTC(2026, 7, 13, 13)]],
      ['https://old.example/', [Date.UTC(2026, 7, 13, 12)]]
    ])
    await expect(clock.clearSince(now - hour)).resolves.toEqual([])
    // Read again, the history has the same visits.
    await expect(new HistoryStore(path, () => now).load()).resolves.toEqual(clock.list())
  })

  // A reload is not another visit: clearing it moves the page back to the visit it reloaded, with its count.
  it('moves a page reloaded within a time range back to its visit before it', async () => {
    const hour = 60 * 60 * 1000
    let now = Date.UTC(2026, 7, 13, 12)
    const { path } = await storeAt()
    const clock = new HistoryStore(path, () => now)
    await clock.load()
    await clock.record({ url: 'https://reloaded.example/', title: 'Reloaded' })
    now += 2 * hour
    await clock.record({ url: 'https://reloaded.example/', title: 'Reloaded', samePage: true })
    await expect(clock.clearSince(now - hour)).resolves.toEqual(['https://reloaded.example/'])
    expect(clock.list()).toEqual([{ id: expect.any(String), url: 'https://reloaded.example/', title: 'Reloaded', visitedAt: new Date(Date.UTC(2026, 7, 13, 12)).toISOString(), visitCount: 1 }])
  })

  // A history saved before visit times were kept knows each page's last visit only.
  it('keeps the last visit of a page saved without its visit times when a time range clears its newer visits', async () => {
    const hour = 60 * 60 * 1000
    let now = Date.UTC(2026, 7, 13, 12)
    const { path } = await storeAt()
    await writeFile(path, JSON.stringify({ version: 1, entries: [
      { id: 'saved', url: 'https://saved.example/', title: 'Saved', visitedAt: new Date(now - 3 * hour).toISOString(), visitCount: 40 },
      { id: 'recent', url: 'https://recent-saved.example/', title: 'Recent', visitedAt: new Date(now - 1_000).toISOString(), visitCount: 3 },
      { id: 'broken', url: 'https://broken.example/', title: 'Broken', visitedAt: new Date(now - 3 * hour).toISOString(), visitCount: 2, recentVisits: ['soon', now], earlierVisitAt: 'never' }
    ] }))
    const store = new HistoryStore(path, () => now)
    await store.load()
    expect(JSON.parse(await readFile(path, 'utf8')).entries.map((entry: { earlierVisitAt?: number; recentVisits?: number[] }) => [entry.earlierVisitAt, entry.recentVisits]))
      .toEqual([[now - 1_000, undefined], [now - 3 * hour, undefined], [now - 3 * hour, undefined]])
    await store.record({ url: 'https://saved.example/', title: 'Saved' })
    await store.record({ url: 'https://broken.example/', title: 'Broken' })
    now += 1
    // A page saved with its last visit within the range goes, as no visit before it is known.
    await expect(store.clearSince(now - hour)).resolves.toEqual(expect.arrayContaining(['https://saved.example/', 'https://broken.example/', 'https://recent-saved.example/']))
    expect(store.list().map(({ url, visitedAt, visitCount }) => [url, visitedAt, visitCount])).toEqual([
      ['https://broken.example/', new Date(now - 1 - 3 * hour).toISOString(), 2],
      ['https://saved.example/', new Date(now - 1 - 3 * hour).toISOString(), 40]
    ])
  })

  it('keeps the newest visits within four weeks, and clears a page whose let-go visits are within the range', async () => {
    const hour = 60 * 60 * 1000
    let now = Date.UTC(2026, 7, 13, 12)
    const { path } = await storeAt()
    const store = new HistoryStore(path, () => now)
    await store.load()
    await store.record({ url: 'https://earlier.example/', title: 'Earlier' })
    await store.record({ url: 'https://aging.example/', title: 'Aging' })
    now += 2 * hour
    await store.record({ url: 'https://busy.example/', title: 'Busy' })
    for (let visit = 0; visit < 100; visit += 1) {
      now += 1_000
      await store.record({ url: 'https://earlier.example/', title: 'Earlier' })
      await store.record({ url: 'https://busy.example/', title: 'Busy' })
    }
    await store.flush()
    const saved = JSON.parse(await readFile(path, 'utf8')).entries as Array<{ url: string; recentVisits: number[]; earlierVisitAt?: number }>
    expect(saved.map((entry) => [entry.url, entry.recentVisits.length, entry.earlierVisitAt])).toEqual([
      ['https://busy.example/', 100, Date.UTC(2026, 7, 13, 14)],
      ['https://earlier.example/', 100, Date.UTC(2026, 7, 13, 12)],
      ['https://aging.example/', 1, undefined]
    ])
    // The busy page's visit let go is within the hour too, so whether it had visits before is not known: it goes.
    await expect(store.clearSince(now - hour)).resolves.toEqual(expect.arrayContaining(['https://busy.example/', 'https://earlier.example/']))
    expect(store.list().map(({ url, visitedAt, visitCount }) => [url, visitedAt, visitCount])).toEqual([
      ['https://aging.example/', new Date(Date.UTC(2026, 7, 13, 12)).toISOString(), 1],
      ['https://earlier.example/', new Date(Date.UTC(2026, 7, 13, 12)).toISOString(), 1]
    ])

    // A visit older than four weeks is let go as the page's earlier visit.
    now += 29 * 24 * hour
    await store.record({ url: 'https://aging.example/', title: 'Aging' })
    await store.flush()
    const [aged] = JSON.parse(await readFile(path, 'utf8')).entries as Array<{ url: string; recentVisits: number[]; earlierVisitAt: number }>
    expect(aged).toEqual(expect.objectContaining({ url: 'https://aging.example/', visitCount: 2, recentVisits: [now], earlierVisitAt: Date.UTC(2026, 7, 13, 12) }))
    await expect(store.clearSince(Number.NaN)).rejects.toThrow('Invalid history time range')
  })

  it('removes the visits of a file it could not read when clearing a time range', async () => {
    const { path, store } = await storeAt()
    await writeFile(path, JSON.stringify({ version: 2, entries: [{ id: 'a', url: 'https://private.example/visit', title: 'Private', visitedAt: '2026-08-12T00:00:00.000Z', visitCount: 1 }] }))
    await expect(store.load()).resolves.toEqual([])
    await expect(store.clearSince(Date.UTC(2026, 7, 13) - 60 * 60 * 1000)).resolves.toEqual([])
    expect(await readFile(path, 'utf8')).not.toContain('private.example')
  })

  it('writes nothing when clearing a history that is already empty', async () => {
    const { path, store } = await storeAt()
    await store.load()
    await store.clear()
    await expect(store.clearOrigin('https://one.example')).resolves.toBe(0)
    await expect(store.clearSince(Date.UTC(2026, 7, 13) - 60 * 60 * 1000)).resolves.toEqual([])
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
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
    expect(store.list()).toEqual([expect.objectContaining({ id: 'new', visitCount: 3 })])
    expect((JSON.parse(await readFile(path, 'utf8')) as { entries: Array<{ id: string }> }).entries)
      .toEqual([expect.objectContaining({ id: 'new', visitCount: 3 })])
  })

  it('preserves visit counts when older saved addresses normalize to the same page', async () => {
    const now = Date.UTC(2026, 7, 13)
    const { path, store } = await storeAt(now)
    await writeFile(path, JSON.stringify({
      version: 1,
      entries: [
        {
          id: 'latest', url: 'https://example.com/page#latest', title: 'Latest title',
          visitedAt: new Date(now - 1_000).toISOString(), visitCount: 3
        },
        {
          id: 'earlier', url: 'https://example.com/page#earlier', title: 'Earlier title',
          visitedAt: new Date(now - 2_000).toISOString(), visitCount: 2
        }
      ]
    }), 'utf8')

    expect(await store.load()).toEqual([expect.objectContaining({
      id: 'latest', url: 'https://example.com/page', title: 'Latest title', visitCount: 5
    })])
    expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual([
      expect.objectContaining({ id: 'latest', url: 'https://example.com/page', visitCount: 5 })
    ])
    expect(await store.record({ url: 'https://example.com/page', title: 'New visit' }))
      .toMatchObject({ visitCount: 6 })
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

  it('keeps history unchanged when removals cannot be saved, and keeps visits for a save that can', async () => {
    const { path, store } = await storeAt()
    const first = await store.record({ url: 'https://one.example/', title: 'One' })
    await store.record({ url: 'https://two.example/', title: 'Two' })
    await store.flush()
    expect(first).not.toBeNull()
    const backupPath = `${path}.backup`
    await rename(path, backupPath)
    await mkdir(path)

    // A visit stays listed while the file cannot be written, as in Chrome, and is saved once it can be.
    await expect(store.record({ url: 'https://three.example/', title: 'Kept visit' })).resolves.toMatchObject({ title: 'Kept visit' })
    const before = store.list()
    expect(before.map((entry) => entry.title)).toEqual(['Kept visit', 'One', 'Two'])
    await expect(store.flush()).rejects.toThrow()
    await expect(store.remove(first!.id)).rejects.toThrow()
    expect(store.list()).toEqual(before)
    await expect(store.clearOrigin('https://one.example')).rejects.toThrow()
    expect(store.list()).toEqual(before)
    await expect(store.clear()).rejects.toThrow()
    expect(store.list()).toEqual(before)

    await rm(path, { recursive: true })
    await rename(backupPath, path)
    await store.flush()
    const restored = new HistoryStore(path, () => Date.UTC(2026, 7, 13))
    expect(await restored.load()).toEqual(before)
  })
})
