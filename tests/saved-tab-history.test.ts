import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NavigationEntry } from 'electron'
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { historyAroundShownPage, savedTabHistories, savedTabHistory, TabHistoryStore } from '../src/main/browser/saved-tab-history/saved-tab-history.js'
import type { NavigationHistorySnapshot } from '../src/main/browser/navigation-history.js'
import type { BrowserWorkspaceNavigationPolicy } from '../src/shared/types.js'

vi.mock('electron', () => ({
  session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => tmpdir() }, powerMonitor: { on: () => undefined }
}))

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'hronaut-saved-tab-history-test-'))
  temporaryDirectories.push(path)
  return path
}

const anywhere: BrowserWorkspaceNavigationPolicy = { mode: 'unrestricted', rules: [] }
const page = (name: string) => `https://example.test/${name}`
/** A page's scroll and form state as Chromium encodes it, here any bytes, with its address and text in UTF-16 as Chromium writes them. */
const pageState = (url: string, text = '') => Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.from(url + text, 'utf16le')]).toString('base64')
const entry = (name: string, state = pageState(page(name))): NavigationEntry => ({ url: page(name), title: name, pageState: state })
const history = (names: string[], index: number): NavigationHistorySnapshot => ({ entries: names.map((name) => entry(name)), index })
const TAB_ID = '019a1b2c-3d4e-7f00-8a00-000000000001'
const OTHER_TAB_ID = '019a1b2c-3d4e-7f00-8a00-000000000002'

describe('the history a restart keeps of a tab', () => {
  it('keeps six pages on each side of the page the tab shows, with their titles and scroll, as Chrome', () => {
    const names = Array.from({ length: 20 }, (_value, index) => `p${index}`)
    const saved = savedTabHistory(history(names, 10), page('p10'), anywhere)!
    expect(saved.entries.map((candidate) => candidate.title)).toEqual(names.slice(4, 17))
    expect(saved.index).toBe(6)
    expect(saved.entries[6]).toEqual(entry('p10'))
  })

  it('keeps nothing while the history does not show the tab\'s address, or holds only that address unscrolled', () => {
    expect(savedTabHistory(history(['a', 'b'], 1), page('a'), anywhere)).toBeUndefined()
    expect(savedTabHistory({ entries: [{ url: page('a'), title: 'a' }], index: 0 }, page('a'), anywhere)).toBeUndefined()
    expect(savedTabHistory(history(['a'], 0), page('a'), anywhere)).toEqual(history(['a'], 0))
  })

  it('leaves out the pages the workspace\'s Site access rules do not let it open, and keeps nothing when the shown one is one', () => {
    const shopOnly: BrowserWorkspaceNavigationPolicy = { mode: 'restricted', rules: ['https://example.test'] }
    const mixed: NavigationHistorySnapshot = {
      entries: [entry('a'), { url: 'https://other.test/', title: 'Other' }, { url: 'file:///etc/passwd', title: 'File' }, entry('b')],
      index: 3
    }
    expect(savedTabHistory(mixed, page('b'), shopOnly)).toEqual({ entries: [entry('a'), entry('b')], index: 1 })
    expect(savedTabHistory({ entries: [entry('a'), { url: 'https://other.test/', title: 'Other' }], index: 1 }, 'https://other.test/', shopOnly)).toBeUndefined()
  })

  it('leaves out the state of a page a form posted to, whose fields it holds, passwords included', () => {
    // The page a sign-in form posted to kept the form's fields in its state, which a restart would write to the disk.
    const posted = Buffer.concat([Buffer.from(page('login') + 'application/x-www-form-urlencoded', 'utf16le'), Buffer.from('password=hunter2')]).toString('base64')
    const multipart = pageState(page('upload'), 'multipart/form-data; boundary=x')
    const plain = Buffer.concat([Buffer.from(page('note'), 'utf16le'), Buffer.from('text/plain')]).toString('base64')
    const saved = savedTabHistory({ entries: [entry('form'), entry('login', posted), entry('upload', multipart), entry('note', plain), entry('next')], index: 4 }, page('next'), anywhere)!
    expect(saved.entries.map((candidate) => candidate.pageState)).toEqual([pageState(page('form')), undefined, undefined, undefined, pageState(page('next'))])
    expect(saved.entries.map((candidate) => candidate.url)).toEqual(['form', 'login', 'upload', 'note', 'next'].map(page))
  })

  it('leaves out a state larger than 64 KiB or not in base64, and an address longer than 64 KiB', () => {
    const large = Buffer.alloc(64 * 1024 + 1, 1).toString('base64')
    const long = `data:text/html,${'x'.repeat(64 * 1024)}`
    const saved = savedTabHistory({
      entries: [entry('a', large), entry('b', 'not base64!'), { url: long, title: 'Long' }, entry('c')], index: 3
    }, page('c'), anywhere)!
    expect(saved.entries).toEqual([{ url: page('a'), title: 'a' }, { url: page('b'), title: 'b' }, entry('c')])
  })

  it('leaves out a state that names another page, which Electron would open in the page\'s place', () => {
    const elsewhere = savedTabHistory({ entries: [entry('a', pageState('file:///etc/passwd')), entry('b')], index: 1 }, page('b'), anywhere)!
    expect(elsewhere.entries).toEqual([{ url: page('a'), title: 'a' }, entry('b')])
  })

  it('reads only the pages a restart can keep, around the page the tab shows', () => {
    const entries = Array.from({ length: 50 }, (_value, index) => entry(`p${index}`))
    const read: number[] = []
    const around = historyAroundShownPage({ length: () => entries.length, getActiveIndex: () => 40, getEntryAtIndex: (index) => { read.push(index); return entries[index] ?? null } })
    expect(around).toEqual({ entries: entries.slice(34, 47), index: 6 })
    expect(read).toEqual(Array.from({ length: 13 }, (_value, index) => 34 + index))
    expect(historyAroundShownPage({ length: () => 0, getActiveIndex: () => -1, getEntryAtIndex: () => null })).toBeUndefined()
    expect(historyAroundShownPage({ length: () => { throw new Error('destroyed') }, getActiveIndex: () => 0, getEntryAtIndex: () => null })).toBeUndefined()
  })

  it('keeps the history saved before of a tab going Back, whose history shows the page it goes to', () => {
    // A save while a tab went Back, as at quit, left the tab without its history, so it restarted without Back.
    const tabs = [{ id: TAB_ID, url: page('c'), mcpGroupId: 'workspace' }]
    const before = new Map([[TAB_ID, history(['a', 'b', 'c'], 2)]])
    const goingBack = savedTabHistories({ tabs: () => tabs, navigationHistory: () => history(['a', 'b', 'c'], 1), navigationPolicy: () => anywhere }, before)
    expect(goingBack).toEqual(before)
    const unreadable = savedTabHistories({ tabs: () => tabs, navigationHistory: () => undefined, navigationPolicy: () => anywhere }, before)
    expect(unreadable).toEqual(before)
    // Once it is on the page before, that is what is saved; a history saved for another page is not.
    const back = [{ ...tabs[0]!, url: page('b') }]
    expect(savedTabHistories({ tabs: () => back, navigationHistory: () => history(['a', 'b', 'c'], 1), navigationPolicy: () => anywhere }, before))
      .toEqual(new Map([[TAB_ID, history(['a', 'b', 'c'], 1)]]))
    expect(savedTabHistories({ tabs: () => back, navigationHistory: () => undefined, navigationPolicy: () => anywhere }, before)).toEqual(new Map())
  })

  it('keeps the history of each open workspace tab, and none of Home or a tab whose workspace is gone', () => {
    const tabs = [
      { id: TAB_ID, url: page('b'), mcpGroupId: 'workspace' },
      { id: 'home', url: 'hronaut://home/' },
      { id: OTHER_TAB_ID, url: page('b'), mcpGroupId: 'closed-workspace' }
    ]
    const saved = savedTabHistories({
      tabs: () => tabs,
      navigationHistory: () => history(['a', 'b'], 1),
      navigationPolicy: (workspaceId) => workspaceId === 'workspace' ? anywhere : undefined
    }, new Map([[OTHER_TAB_ID, history(['a', 'b'], 1)]]))
    expect([...saved]).toEqual([[TAB_ID, history(['a', 'b'], 1)]])
  })
})

describe('the saved tab history file', () => {
  it('keeps each tab\'s history for the next start, readable only by the person', async () => {
    const path = join(await directory(), 'tab-history.json')
    await new TabHistoryStore(path).save(() => new Map([[TAB_ID, history(['a', 'b'], 1)]]))
    expect(await new TabHistoryStore(path).load()).toEqual(new Map([[TAB_ID, history(['a', 'b'], 1)]]))
    if (process.platform !== 'win32') expect((await lstat(path)).mode & 0o777).toBe(0o600)
  })

  it('writes only when the history changed, and nothing once the browser closes', async () => {
    const path = join(await directory(), 'tab-history.json')
    const store = new TabHistoryStore(path)
    await store.save(() => new Map([[TAB_ID, history(['a', 'b'], 1)]]))
    await rm(path)
    await store.save(() => new Map([[TAB_ID, history(['a', 'b'], 1)]]))
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    await store.save(() => undefined)
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    await store.save(() => new Map([[TAB_ID, history(['b'], 0)]]))
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, tabs: { [TAB_ID]: history(['b'], 0) } })
  })

  it('gives no history when the file is missing, unreadable or not a saved history, so the tabs open their addresses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const folder = await directory()
    expect(await new TabHistoryStore(join(folder, 'missing.json')).load()).toEqual(new Map())
    expect(warn).not.toHaveBeenCalled()
    await writeFile(join(folder, 'broken.json'), '{"version":1,"tabs":')
    expect(await new TabHistoryStore(join(folder, 'broken.json')).load()).toEqual(new Map())
    await writeFile(join(folder, 'future.json'), JSON.stringify({ version: 2, tabs: { [TAB_ID]: history(['a'], 0) } }))
    expect(await new TabHistoryStore(join(folder, 'future.json')).load()).toEqual(new Map())
    await writeFile(join(folder, 'target.json'), JSON.stringify({ version: 1, tabs: { [TAB_ID]: history(['a'], 0) } }))
    await symlink(join(folder, 'target.json'), join(folder, 'link.json'))
    expect(await new TabHistoryStore(join(folder, 'link.json')).load()).toEqual(new Map())
    expect(warn).toHaveBeenCalledTimes(3)
    // The messages name no page.
    expect(warn.mock.calls.flat().join(' ')).not.toContain('example.test')
  })

  it('forgets cleared pages in the history saved before, so a tab whose history cannot be read does not bring them back', async () => {
    const path = join(await directory(), 'tab-history.json')
    const store = new TabHistoryStore(path)
    await store.save(() => new Map([[TAB_ID, history(['a', 'b', 'c'], 2)], [OTHER_TAB_ID, history(['a', 'b'], 1)]]))
    store.forgetPages((url) => url === page('a') || url === page('c'), new Set([TAB_ID]))
    let previous: ReadonlyMap<string, NavigationHistorySnapshot> | undefined
    await store.save((before) => { previous = before; return before })
    expect(previous).toEqual(new Map([[TAB_ID, history(['b', 'c'], 1)], [OTHER_TAB_ID, history(['a', 'b'], 1)]]))
    store.forgetPages((url) => url === page('a'), undefined)
    await store.save((before) => { previous = before; return before })
    expect(previous).toEqual(new Map([[TAB_ID, history(['b', 'c'], 1)], [OTHER_TAB_ID, history(['b'], 0)]]))
  })

  it('skips a tab whose saved history is not one and keeps the others', async () => {
    const path = join(await directory(), 'tab-history.json')
    await writeFile(path, JSON.stringify({
      version: 1,
      tabs: {
        [TAB_ID]: history(['a', 'b'], 1),
        [OTHER_TAB_ID]: { entries: [entry('a')], index: 1 },
        'not-a-tab-id': history(['a'], 0),
        '019a1b2c-3d4e-7f00-8a00-000000000003': { entries: [{ url: page('a'), title: 7 }], index: 0 },
        '019a1b2c-3d4e-7f00-8a00-000000000004': { entries: Array.from({ length: 14 }, () => entry('a')), index: 0 }
      }
    }))
    expect(await new TabHistoryStore(path).load()).toEqual(new Map([[TAB_ID, history(['a', 'b'], 1)]]))
  })
})

describe('the tab manager saving the tabs\' history', () => {
  it('saves it without the pages whose history was cleared at once', async () => {
    const entries = [entry('a'), entry('b')]
    let activeIndex = 1
    const webContents = {
      isDestroyed: () => false,
      navigationHistory: {
        length: () => entries.length,
        getActiveIndex: () => activeIndex,
        getEntryAtIndex: (index: number) => entries[index] ?? null,
        getAllEntries: () => entries.map((candidate) => ({ ...candidate })),
        removeEntryAtIndex: (index: number) => {
          if (index === activeIndex) return false
          entries.splice(index, 1)
          if (index < activeIndex) activeIndex -= 1
          return true
        }
      }
    }
    const saved: Array<ReadonlyMap<string, NavigationHistorySnapshot> | undefined> = []
    const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
      closedTabs: [],
      detachedClosedTabs: new Set(),
      tabs: new Map([[TAB_ID, { id: TAB_ID, url: page('b'), mcpGroupId: 'workspace', sleeping: false, webContents }]]),
      mcpTabGroups: new Map([['workspace', { navigationPolicy: anywhere }]]),
      initialized: true,
      destroyed: false,
      changed: vi.fn(),
      tabHistoryStore: {
        forgetPages: vi.fn(),
        save: async (histories: (previous: ReadonlyMap<string, NavigationHistorySnapshot>) => ReadonlyMap<string, NavigationHistorySnapshot> | undefined) => { saved.push(histories(new Map())) }
      }
    }) as BrowserTabsManager
    manager.forgetHistoryPages((url) => url === page('a'))
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toEqual(new Map([[TAB_ID, history(['b'], 0)]]))
    expect((manager as unknown as { tabHistoryStore: { forgetPages: ReturnType<typeof vi.fn> } }).tabHistoryStore.forgetPages)
      .toHaveBeenCalledWith(expect.any(Function), undefined)
  })
})
