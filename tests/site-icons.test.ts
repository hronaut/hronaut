import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookmarkStore } from '../src/main/bookmarks-history/bookmark-store.js'
import { createBookmarksAndHistory } from '../src/main/bookmarks-history/bookmarks-and-history.js'
import { HistoryStore } from '../src/main/bookmarks-history/history-store.js'
import { MAX_SITE_ICONS, SiteIconStore } from '../src/main/bookmarks-history/site-icon-store.js'
import { HISTORY_IPC } from '../src/shared/ipc/history.js'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const temporaryDirectories: string[] = []

afterEach(async () => {
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

describe('the websites\' icons', () => {
  it('keeps the icon a tab showed by its page\'s website, and only web pages\' PNG icons', async () => {
    const icons = new SiteIconStore(join(await directory(), 'site-icons.json'))
    await icons.load()

    expect(icons.remember('https://docs.example/guide?page=2#top', icon('docs'))).toBe('https://docs.example')
    expect(icons.remember('https://docs.example/other', icon('docs'))).toBeNull()
    expect(icons.remember('https://docs.example/other', icon('docs, again'))).toBe('https://docs.example')
    expect(icons.remember('file:///home/me/page.html', icon('file'))).toBeNull()
    expect(icons.remember('https://svg.example/', 'data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
    expect(icons.remember('https://large.example/', `data:image/png;base64,${'A'.repeat(20_000)}`)).toBeNull()

    expect(icons.all()).toEqual({ 'https://docs.example': icon('docs, again') })
    icons.dispose()
  })

  it('saves them, reads them back, and reads nothing it does not trust from the file', async () => {
    const path = join(await directory(), 'site-icons.json')
    const icons = new SiteIconStore(path)
    await icons.load()
    icons.remember('https://docs.example/', icon('docs'))
    await icons.flush()
    const saved = JSON.parse(await readFile(path, 'utf8')) as { icons: unknown[] }
    await writeFile(path, JSON.stringify({ ...saved, icons: [
      ...saved.icons,
      { origin: 'https://docs.example/path', icon: icon('not an origin') },
      { origin: 'https://script.example', icon: 'javascript:alert(1)' },
      null
    ] }))

    const reopened = new SiteIconStore(path)
    await reopened.load()
    expect(reopened.all()).toEqual({ 'https://docs.example': icon('docs') })

    await writeFile(path, JSON.stringify({ ...saved, version: 2 }))
    await reopened.load()
    expect(reopened.all()).toEqual({})
    icons.dispose()
    reopened.dispose()
  })

  it('keeps the websites shown last, up to its limit', async () => {
    const icons = new SiteIconStore(join(await directory(), 'site-icons.json'))
    await icons.load()
    for (let index = 0; index < MAX_SITE_ICONS; index += 1) icons.remember(`https://site${index}.example/`, icon(`site ${index}`))
    // Shown again, the first website is no longer the one shown longest ago.
    icons.remember('https://site0.example/', icon('site 0'))
    icons.remember('https://new.example/', icon('new'))

    const kept = Object.keys(icons.all())
    expect(kept).toHaveLength(MAX_SITE_ICONS)
    expect(kept).toContain('https://site0.example')
    expect(kept).toContain('https://new.example')
    expect(kept).not.toContain('https://site1.example')
    icons.dispose()
  })

  it('lets go of a website\'s icon, at once on disk, when the history and bookmarks hold no page of it', async () => {
    const folder = await directory()
    const bookmarks = new BookmarkStore(join(folder, 'bookmarks.json'))
    const history = new HistoryStore(join(folder, 'history.json'))
    const siteIcons = new SiteIconStore(join(folder, 'site-icons.json'))
    await Promise.all([bookmarks.load(), history.load(), siteIcons.load()])
    const sendToShellWindows = vi.fn()
    const runtime = createBookmarksAndHistory({
      state: { bookmarks, history, siteIcons },
      sendToShellWindows,
      mcpServer: () => null,
      tabs: () => null,
      offerUndo: vi.fn()
    })
    await history.record({ url: 'https://news.example/today', title: 'News' })
    await history.record({ url: 'https://docs.example/guide', title: 'Guide' })
    const saved = await bookmarks.add({ url: 'https://docs.example/start', title: 'Start' })

    runtime.pageHistoryCallbacks.onSiteIcon({ url: 'https://news.example/today', icon: icon('news') })
    runtime.pageHistoryCallbacks.onSiteIcon({ url: 'https://docs.example/guide', icon: icon('docs') })
    await vi.waitFor(() => expect(sendToShellWindows).toHaveBeenCalledWith(HISTORY_IPC.siteIconsChanged, {
      'https://news.example': icon('news'),
      'https://docs.example': icon('docs')
    }))

    // Clearing the history keeps the bookmarked website's icon.
    await runtime.agentHistory.clear()
    expect(siteIcons.all()).toEqual({ 'https://docs.example': icon('docs') })
    await vi.waitFor(() => expect(sendToShellWindows).toHaveBeenCalledWith(HISTORY_IPC.siteIconsChanged, { 'https://news.example': null }))
    await vi.waitFor(async () => expect(await readFile(join(folder, 'site-icons.json'), 'utf8')).not.toContain(icon('news').split(',')[1]))

    await runtime.agentBookmarks.remove(saved.id)
    expect(siteIcons.all()).toEqual({})
    await vi.waitFor(() => expect(sendToShellWindows).toHaveBeenCalledWith(HISTORY_IPC.siteIconsChanged, { 'https://docs.example': null }))
    siteIcons.dispose()
    history.dispose()
  })
})
