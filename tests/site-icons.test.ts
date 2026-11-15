import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookmarkStore } from '../src/main/bookmarks-history/bookmark-store.js'
import { createBookmarksAndHistory, type BookmarksAndHistoryState } from '../src/main/bookmarks-history/bookmarks-and-history.js'
import { MAX_SITE_ICON_PAGES, MAX_UNLISTED_SITE_ICONS, SiteIconStore } from '../src/main/bookmarks-history/site-icon-store.js'
import { HISTORY_IPC } from '../src/shared/ipc/history.js'
import { SiteIconIndex, siteIconOrigin, withSiteIconChanges, type SiteIconChanges, type SiteIcons } from '../src/shared/site-icons.js'
import { normalizeHistoryUrl } from '../src/shared/visit-history.js'
import type { UndoableAction } from '../src/main/undo-offers.js'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => paths.userData } }))

const temporaryDirectories: string[] = []
const closing: (() => Promise<void>)[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const close of closing.splice(0)) await close()
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'hronaut-site-icons-test-'))
  temporaryDirectories.push(path)
  return path
}

/** A PNG data URL as a tab shows an icon; the letters only tell icons apart. */
function icon(name: string): string {
  return `data:image/png;base64,${Buffer.from(name).toString('base64')}`
}

function iconName(dataUrl: string | undefined): string | undefined {
  return dataUrl === undefined ? undefined : Buffer.from(dataUrl.split(',')[1]!, 'base64').toString()
}

/** Each page's icon, by the icon's letters. */
function pageIcons(icons: SiteIcons): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(icons.pages).map(([page, id]) => [page, iconName(icons.icons[id])]))
}

async function openStore(path: string): Promise<SiteIconStore> {
  const store = new SiteIconStore(path)
  await store.load()
  closing.push(async () => {
    store.dispose()
    await store.flush()
  })
  return store
}

/** The bookmarks and history at runtime, opened as the window opens them, from this profile folder. */
async function openRuntime(folder: string) {
  paths.userData = folder
  const state: BookmarksAndHistoryState = { bookmarks: null, history: null, siteIcons: null }
  const sendToShellWindows = vi.fn()
  const offerUndo = vi.fn<(action: UndoableAction) => void>()
  const runtime = createBookmarksAndHistory({ state, sendToShellWindows, mcpServer: () => null, tabs: () => null, offerUndo })
  await runtime.openBookmarks()
  await runtime.openVisitHistory()
  closing.push(async () => {
    runtime.dispose()
    state.history?.dispose()
    state.siteIcons?.dispose()
    await Promise.all([state.history?.flush(), state.siteIcons?.flush(), state.bookmarks?.flush()])
  })
  /** The icons the windows were told of, each change put in turn into an empty list. */
  const sent = (): SiteIcons => sendToShellWindows.mock.calls
    .filter(([channel]) => channel === HISTORY_IPC.siteIconsChanged)
    .reduce<SiteIcons>((icons, [, changes]) => withSiteIconChanges(icons, changes as SiteIconChanges), { pages: {}, icons: {} })
  const kept = () => pageIcons(state.siteIcons!.snapshot())
  return { runtime, state, offerUndo, sent, kept }
}

describe('the icons kept for pages', () => {
  it('keeps the icon a tab showed for each listed page, once however many pages show it', async () => {
    const icons = await openStore(join(await directory(), 'site-icons.json'))

    // A page the history and bookmarks do not hold yet waits for them.
    expect(icons.remember('https://user:secret@docs.example/guide#top', icon('docs'))).toBe('unlisted')
    expect(icons.hasUnlisted()).toBe(true)
    const listed = icons.sync(new Set(['https://docs.example/guide', 'https://docs.example/sheet']))
    expect(pageIcons(icons.snapshot())).toEqual({ 'https://docs.example/guide': 'docs' })
    expect(Object.values(listed!.icons)).toEqual([icon('docs')])
    expect(icons.hasUnlisted()).toBe(false)

    // Another page with the same icon shares it.
    icons.remember('https://docs.example/sheet', icon('docs'))
    expect(icons.listPages(['https://docs.example/sheet'])!.icons).toEqual({})
    expect(Object.keys(icons.snapshot().icons)).toHaveLength(1)
    expect(icons.remember('https://docs.example/sheet', icon('docs'))).toBeNull()

    // A page's own icon replaces the one it showed; the other page keeps that one.
    const changed = icons.remember('https://docs.example/sheet', icon('sheets')) as SiteIconChanges
    expect(Object.keys(changed.pages)).toEqual(['https://docs.example/sheet'])
    expect(Object.values(changed.icons)).toEqual([icon('sheets')])
    expect(pageIcons(icons.snapshot())).toEqual({ 'https://docs.example/guide': 'docs', 'https://docs.example/sheet': 'sheets' })

    // Only web pages' PNG icons, of a size a tab shows, are kept.
    for (const [url, value] of [
      ['file:///home/me/page.html', icon('file')],
      ['https://svg.example/', 'data:image/svg+xml;base64,PHN2Zz4='],
      ['https://large.example/', `data:image/png;base64,${'A'.repeat(20_000)}`]
    ] as const) icons.remember(url, value)
    expect(icons.sync(new Set(['https://docs.example/guide', 'https://docs.example/sheet', 'https://svg.example/', 'https://large.example/']))).toBeNull()
  })

  it('saves them, reads them back, and reads nothing it does not trust from the file', async () => {
    const path = join(await directory(), 'site-icons.json')
    const icons = await openStore(path)
    icons.remember('https://docs.example/guide', icon('docs'))
    icons.listPages(['https://docs.example/guide'])
    await icons.flush()
    const saved = JSON.parse(await readFile(path, 'utf8')) as { icons: string[]; pages: [string, number][] }
    expect(saved.icons).toEqual([icon('docs')])
    await writeFile(path, JSON.stringify({
      ...saved,
      icons: [...saved.icons, 'javascript:alert(1)'],
      pages: [...saved.pages, ['https://docs.example/page#fragment', 0], ['https://docs.example/script', 1], ['https://docs.example/none', 9], null]
    }))

    const reopened = await openStore(path)
    expect(pageIcons(reopened.snapshot())).toEqual({ 'https://docs.example/guide': 'docs' })

    await writeFile(path, JSON.stringify({ ...saved, version: 2 }))
    await reopened.load()
    expect(reopened.snapshot()).toEqual({ pages: {}, icons: {} })
  })

  it('keeps the pages whose icons changed last up to its limit, telling of those it let go', async () => {
    const icons = await openStore(join(await directory(), 'site-icons.json'))
    icons.remember('https://first.example/', icon('first'))
    icons.listPages(['https://first.example/'])
    for (let index = 1; index < MAX_SITE_ICON_PAGES; index += 1) {
      icons.remember(`https://site.example/${index}`, icon('site'))
      icons.listPages([`https://site.example/${index}`])
    }
    icons.remember('https://new.example/', icon('new'))
    const changes = icons.listPages(['https://new.example/'])!

    const kept = icons.snapshot()
    expect(Object.keys(kept.pages)).toHaveLength(MAX_SITE_ICON_PAGES)
    expect(changes.pages['https://first.example/']).toBeNull()
    expect(Object.entries(changes.icons).map(([, value]) => iconName(value ?? undefined))).toEqual(['new', undefined])
    expect(Object.values(kept.icons).map(iconName).sort()).toEqual(['new', 'site'])

    // Icons that wait for their pages are kept for the last pages only.
    for (let index = 0; index <= MAX_UNLISTED_SITE_ICONS; index += 1) icons.remember(`https://waiting.example/${index}`, icon('waiting'))
    const waiting = Array.from({ length: MAX_UNLISTED_SITE_ICONS + 1 }, (_, index) => `https://waiting.example/${index}`)
    const joined = Object.entries(icons.listPages(waiting)!.pages).filter(([, id]) => id !== null).map(([page]) => page)
    expect(joined).toEqual(waiting.slice(1))
  })

  it('tries a save that failed again a while later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const path = join(await directory(), 'site-icons.json')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // The file's place is taken, so saving it fails.
    await mkdir(path)
    const icons = await openStore(path)
    icons.remember('https://docs.example/guide', icon('docs'))
    icons.listPages(['https://docs.example/guide'])
    await icons.flush()
    expect(error).toHaveBeenCalledWith('[site icons] Failed to save site icons:', expect.anything())

    // With no change after it, the save is tried again a while later.
    await rmdir(path)
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.waitFor(async () => expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ icons: [icon('docs')] }))
    expect(error).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('stops keeping icons once disposed, but still lets go at once of those a clear that ends meanwhile takes', async () => {
    const path = join(await directory(), 'site-icons.json')
    const icons = await openStore(path)
    icons.remember('https://docs.example/guide', icon('docs'))
    icons.remember('https://news.example/today', icon('news'))
    icons.listPages(['https://docs.example/guide', 'https://news.example/today'])

    icons.dispose()
    expect(icons.remember('https://docs.example/guide', icon('later'))).toBeNull()
    // No timed save is left once disposed, so the icons let go are saved at once.
    icons.sync(new Set(['https://docs.example/guide']))
    await vi.waitFor(async () => expect(await readFile(path, 'utf8')).not.toContain(icon('news').split(',')[1]))
    expect(await readFile(path, 'utf8')).toContain(icon('docs').split(',')[1])
  })

  it('waits, when flushed, for a save a change made meanwhile started', async () => {
    const path = join(await directory(), 'site-icons.json')
    const icons = await openStore(path)
    icons.remember('https://docs.example/guide', icon('docs'))
    icons.remember('https://news.example/today', icon('news'))
    icons.listPages(['https://docs.example/guide', 'https://news.example/today'])
    await icons.flush()

    // As a clear that ends while Hronaut quits, after its last flush began.
    const flushing = icons.flush()
    icons.sync(new Set(['https://docs.example/guide']), { saveAtOnce: true })
    await flushing
    expect(await readFile(path, 'utf8')).not.toContain(icon('news').split(',')[1])
  })
})

describe('the icons History and Bookmarks show', () => {
  it('are a page\'s own, or else its website\'s that changed last, or none', () => {
    const icons = new SiteIconIndex({
      pages: { 'https://docs.example/document': 'a', 'https://docs.example/sheet': 'b', 'https://news.example/today': 'c' },
      icons: { a: icon('document'), b: icon('sheet') }
    })
    expect(iconName(icons.iconFor('https://docs.example/document', 'https://docs.example'))).toBe('document')
    expect(iconName(icons.iconFor('https://docs.example/form', 'https://docs.example'))).toBe('sheet')
    // An icon that is not there shows none, and another website's pages do not lend theirs.
    expect(icons.iconFor('https://news.example/today', 'https://news.example')).toBeUndefined()
    expect(icons.iconFor('https://other.example/', 'https://other.example')).toBeUndefined()
    expect(icons.iconFor(null, null)).toBeUndefined()

    // A website's pages are found by its origin however its address is written.
    for (const address of ['HTTP://Example.COM:80/a?b', 'https://[::1]:8443/', 'https://xn--bcher-kva.example/x', 'https://bücher.example/y']) {
      const page = normalizeHistoryUrl(address)!
      const index = new SiteIconIndex({ pages: { [page]: 'a' }, icons: { a: icon(address) } })
      expect(iconName(index.iconFor(null, siteIconOrigin(address)))).toBe(address)
    }
  })

  it('take the changes in the order they were made', () => {
    const icons = withSiteIconChanges(
      { pages: { 'https://a.example/': 'a', 'https://b.example/': 'b' }, icons: { a: icon('a'), b: icon('b') } },
      { pages: { 'https://a.example/': 'c', 'https://b.example/': null }, icons: { c: icon('c'), b: null } }
    )
    expect(icons).toEqual({ pages: { 'https://a.example/': 'c' }, icons: { a: icon('a'), c: icon('c') } })
  })
})

describe('the icons the history and bookmarks keep', () => {
  // A tab's icon was kept for its website whether or not the history held any of its pages, such as a page restored
  // after the history was cleared.
  it('keeps a page\'s icon once the history or bookmarks hold the page, whenever its visit is recorded', async () => {
    const { runtime, state, sent, kept } = await openRuntime(await directory())

    runtime.pageHistoryCallbacks.onSiteIcon({ url: 'https://news.example/today', icon: icon('news') })
    runtime.pageHistoryCallbacks.onPageVisited({ url: 'https://news.example/today', title: 'News', samePage: false })
    await state.history!.record({ url: 'https://docs.example/guide', title: 'Guide' })
    runtime.pageHistoryCallbacks.onSiteIcon({ url: 'https://docs.example/guide', icon: icon('docs') })
    runtime.pageHistoryCallbacks.onSiteIcon({ url: 'https://private.example/', icon: icon('private') })

    const expected = { 'https://news.example/today': 'news', 'https://docs.example/guide': 'docs' }
    await vi.waitFor(() => expect(pageIcons(sent())).toEqual(expected))
    expect(kept()).toEqual(expected)
    await state.siteIcons!.flush()
    expect(await readFile(join(paths.userData, 'site-icons.json'), 'utf8')).not.toContain(icon('private').split(',')[1])

    // An icon that waits for its visit stays waiting while the history changes otherwise.
    runtime.pageHistoryCallbacks.onSiteIcon({ url: 'https://later.example/', icon: icon('later') })
    await runtime.agentHistory.remove(state.history!.list().find((entry) => entry.url === 'https://docs.example/guide')!.id)
    runtime.pageHistoryCallbacks.onPageVisited({ url: 'https://later.example/', title: 'Later', samePage: false })
    await vi.waitFor(() => expect(kept()).toEqual({ 'https://news.example/today': 'news', 'https://later.example/': 'later' }))
  })

  it('lets go of a page\'s icon, at once on disk, when the history and bookmarks no longer hold the page', async () => {
    const folder = await directory()
    const { runtime, state, offerUndo, sent, kept } = await openRuntime(folder)
    const saved = await state.bookmarks!.add({ url: 'https://docs.example/start#intro', title: 'Start' })
    for (const page of ['https://news.example/today', 'https://news.example/sports', 'https://docs.example/start', 'https://docs.example/guide']) {
      await state.history!.record({ url: page, title: page })
      runtime.pageHistoryCallbacks.onSiteIcon({ url: page, icon: icon(page) })
    }
    await vi.waitFor(() => expect(Object.keys(sent().pages)).toHaveLength(4))
    const onDisk = () => readFile(join(folder, 'site-icons.json'), 'utf8')

    // As Settings clears a website's history.
    await state.history!.clearOrigin('https://news.example')
    runtime.publishVisitHistory()
    expect(Object.keys(kept())).toEqual(['https://docs.example/start', 'https://docs.example/guide'])
    await vi.waitFor(async () => expect(await onDisk()).not.toContain(icon('https://news.example/today').split(',')[1]))

    // Clearing the history keeps the bookmarked page's icon.
    await runtime.agentHistory.clear()
    expect(Object.keys(kept())).toEqual(['https://docs.example/start'])
    await vi.waitFor(() => expect(Object.keys(sent().pages)).toEqual(['https://docs.example/start']))

    // Removing the bookmark lets go of it, and Undo brings it back.
    const removed = (await state.bookmarks!.removeRestorably(saved.id))!
    runtime.publishBookmarks()
    runtime.undoHooks.bookmarkRemoved(removed)
    expect(kept()).toEqual({})
    await vi.waitFor(async () => expect(JSON.parse(await onDisk())).toMatchObject({ pages: [] }))
    await offerUndo.mock.calls[0]![0].undo()
    expect(kept()).toEqual({ 'https://docs.example/start': 'https://docs.example/start' })
    await vi.waitFor(() => expect(pageIcons(sent())).toEqual(kept()))
  })

  it('lets go of the icons of pages the history left out since the last run, or past its 2,000 pages', async () => {
    const folder = await directory()
    const first = await openRuntime(folder)
    for (const page of ['https://old.example/', 'https://kept.example/']) {
      first.runtime.pageHistoryCallbacks.onPageVisited({ url: page, title: page, samePage: false })
      first.runtime.pageHistoryCallbacks.onSiteIcon({ url: page, icon: icon(page) })
    }
    await vi.waitFor(() => expect(Object.keys(first.kept())).toHaveLength(2))
    for (const close of closing.splice(0)) await close()

    // While Hronaut was closed, a page's visit grew older than the history keeps, and the history is now full.
    const day = 24 * 60 * 60 * 1000
    const visit = (id: string, url: string, at: number) => ({ id, url, title: id, visitedAt: new Date(at).toISOString(), visitCount: 1 })
    const history = JSON.parse(await readFile(join(folder, 'history.json'), 'utf8')) as { entries: { url: string; visitedAt: string }[] }
    const now = Date.now()
    await writeFile(join(folder, 'history.json'), JSON.stringify({
      ...history,
      entries: [
        visit('old', 'https://old.example/', now - 91 * day),
        visit('kept', 'https://kept.example/', now - day),
        ...Array.from({ length: 1_999 }, (_, index) => visit(`page-${index}`, `https://pages.example/${index}`, now - 60_000))
      ]
    }))

    const saves = vi.spyOn(SiteIconStore.prototype as unknown as { saveNow(): void }, 'saveNow')
    const second = await openRuntime(folder)
    expect(second.kept()).toEqual({ 'https://kept.example/': 'https://kept.example/' })
    // A page that grew too old is no removal, so it leaves the file with the next timed save.
    expect(saves).not.toHaveBeenCalled()
    await second.state.siteIcons!.flush()
    expect(await readFile(join(folder, 'site-icons.json'), 'utf8')).not.toContain(icon('https://old.example/').split(',')[1])

    // One more page leaves the oldest out, also with the next timed save rather than a rewrite for each visit.
    saves.mockClear()
    second.runtime.pageHistoryCallbacks.onPageVisited({ url: 'https://new.example/', title: 'New', samePage: false })
    await vi.waitFor(() => expect(second.kept()).toEqual({}))
    expect(saves).not.toHaveBeenCalled()
  })

  it('lets the icons of pages too old for the history go with the next timed save', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { runtime, state, kept } = await openRuntime(await directory())
    runtime.pageHistoryCallbacks.onPageVisited({ url: 'https://old.example/', title: 'Old', samePage: false })
    runtime.pageHistoryCallbacks.onSiteIcon({ url: 'https://old.example/', icon: icon('old') })
    await vi.waitFor(() => expect(kept()).toEqual({ 'https://old.example/': 'old' }))
    const saves = vi.spyOn(SiteIconStore.prototype as unknown as { saveNow(): void }, 'saveNow')

    vi.setSystemTime(Date.now() + 91 * 24 * 60 * 60 * 1000)
    await state.history!.pruneExpired()
    expect(kept()).toEqual({})
    expect(saves).not.toHaveBeenCalled()
  })

  it('wait for both the history and the bookmarks before letting any icon go', async () => {
    const folder = await directory()
    const first = await openRuntime(folder)
    await first.state.bookmarks!.add({ url: 'https://docs.example/start', title: 'Start' })
    first.runtime.publishBookmarks()
    first.runtime.pageHistoryCallbacks.onSiteIcon({ url: 'https://docs.example/start', icon: icon('docs') })
    await vi.waitFor(() => expect(first.kept()).toEqual({ 'https://docs.example/start': 'docs' }))
    for (const close of closing.splice(0)) await close()

    paths.userData = folder
    const state: BookmarksAndHistoryState = { bookmarks: null, history: null, siteIcons: null }
    const runtime = createBookmarksAndHistory({ state, sendToShellWindows: vi.fn(), mcpServer: () => null, tabs: () => null, offerUndo: vi.fn() })
    closing.push(async () => {
      runtime.dispose()
      state.history?.dispose()
      state.siteIcons?.dispose()
      await Promise.all([state.history?.flush(), state.siteIcons?.flush()])
    })
    // The bookmarks file is still being read while the history is open.
    const load = BookmarkStore.prototype.load
    let readBookmarks!: () => void
    const bookmarksRead = new Promise<void>((resolve) => { readBookmarks = resolve })
    vi.spyOn(BookmarkStore.prototype, 'load').mockImplementationOnce(async function (this: BookmarkStore) {
      await bookmarksRead
      return load.call(this)
    })
    const bookmarksOpen = runtime.openBookmarks()
    await runtime.openVisitHistory()
    // The history holds no page of the bookmarks, which are not read yet.
    runtime.publishVisitHistory()
    expect(pageIcons(state.siteIcons!.snapshot())).toEqual({ 'https://docs.example/start': 'docs' })
    readBookmarks()
    await bookmarksOpen
    expect(pageIcons(state.siteIcons!.snapshot())).toEqual({ 'https://docs.example/start': 'docs' })
  })
})
