import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NavigationEntry } from 'electron'
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { savedTabHistories, savedTabHistory, TabHistoryStore } from '../src/main/browser/saved-tab-history/saved-tab-history.js'
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
/** A page's scroll and form state as Chromium encodes it, here any bytes, with the text in UTF-16 as Chromium writes it. */
const pageState = (text = 'scrolled') => Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.from(text, 'utf16le')]).toString('base64')
const entry = (name: string, state = pageState(name)): NavigationEntry => ({ url: page(name), title: name, pageState: state })
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
    const posted = Buffer.concat([Buffer.from('application/x-www-form-urlencoded', 'utf16le'), Buffer.from('password=hunter2')]).toString('base64')
    const multipart = Buffer.from('multipart/form-data; boundary=x', 'utf16le').toString('base64')
    const plain = Buffer.from('text/plain').toString('base64')
    const saved = savedTabHistory({ entries: [entry('form'), entry('login', posted), entry('upload', multipart), entry('note', plain), entry('next')], index: 4 }, page('next'), anywhere)!
    expect(saved.entries.map((candidate) => candidate.pageState)).toEqual([pageState('form'), undefined, undefined, undefined, pageState('next')])
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

  it('keeps the history of each open workspace tab, and none of Home or a tab whose workspace is gone', () => {
    const tabs = [
      { id: TAB_ID, url: page('b'), mcpGroupId: 'workspace' },
      { id: 'home', url: 'hronaut://home/' },
      { id: OTHER_TAB_ID, url: page('b'), mcpGroupId: 'closed-workspace' }
    ]
    const saved = savedTabHistories({
      tabs: () => tabs,
      navigationHistorySnapshot: () => history(['a', 'b'], 1),
      navigationPolicy: (workspaceId) => workspaceId === 'workspace' ? anywhere : undefined
    })
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
      tabHistoryStore: { save: async (histories: () => ReadonlyMap<string, NavigationHistorySnapshot> | undefined) => { saved.push(histories()) } }
    }) as BrowserTabsManager
    manager.forgetHistoryPages((url) => url === page('a'))
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toEqual(new Map([[TAB_ID, history(['b'], 0)]]))
  })
})
