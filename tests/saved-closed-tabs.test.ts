import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NavigationEntry } from 'electron'
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { ClosedTabsStore, restoredClosedTabs, savedClosedTabs, type SavedClosedTab, type SavedClosedTabsAccess } from '../src/main/browser/saved-closed-tabs/saved-closed-tabs.js'
import { closedTabHistory, rememberClosedTab, rememberSavedClosedTabs, reopenClosedTabEntry } from '../src/main/browser/tab-reopening/tab-reopening.js'
import type { TabReopeningAccess, TabReopeningCreation, TabReopeningTab } from '../src/main/browser/tab-reopening/tab-reopening-access.js'
import type { NavigationHistorySnapshot } from '../src/main/browser/navigation-history.js'
import type { BrowserClosedTabState, BrowserWorkspaceNavigationPolicy } from '../src/shared/types.js'

vi.mock('electron', () => ({
  session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => tmpdir() }, powerMonitor: { on: () => undefined }
}))

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'hronaut-saved-closed-tabs-test-'))
  temporaryDirectories.push(path)
  return path
}

const anywhere: BrowserWorkspaceNavigationPolicy = { mode: 'unrestricted', rules: [] }
const shopOnly: BrowserWorkspaceNavigationPolicy = { mode: 'restricted', rules: ['https://example.test'] }
const address = (name: string) => `https://example.test/${name}`
/** A page's scroll and form state as Chromium encodes it, here any bytes, with its address in UTF-16 as Chromium writes it. */
const pageState = (url: string) => Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.from(url, 'utf16le')]).toString('base64')
const page = (url: string): NavigationEntry => ({ url, title: url.slice(url.lastIndexOf('/') + 1), pageState: pageState(url) })

/** Open tabs of workspaces that the test closes, as the tab manager remembers them. */
function browser(policies: Record<string, BrowserWorkspaceNavigationPolicy> = { work: anywhere }) {
  const closedTabs: BrowserClosedTabState[] = []
  const created: TabReopeningCreation[] = []
  let history: NavigationHistorySnapshot = { entries: [], index: 0 }
  const access: TabReopeningAccess<TabReopeningTab> = {
    closedTabs: () => closedTabs,
    detachedClosedTabs: () => new Set(),
    tabCount: () => 0,
    orderedTabs: () => [],
    getTab: () => { throw new Error('Not used to close or reopen a tab') },
    navigationHistorySnapshot: () => history,
    createTab: async (options) => {
      created.push(options)
      return { id: `reopened-${created.length}`, url: options.url, title: '', pinned: false, zoomIsolated: false, tabMuted: false, tabAgentPaused: false, humanInteractionLocked: false }
    },
    reorderTab: () => ({}) as never,
    getState: () => ({}) as never
  }
  const saving: SavedClosedTabsAccess = {
    closedTabs: () => closedTabs,
    closedTabHistory,
    navigationPolicy: (workspaceId) => policies[workspaceId]
  }
  return {
    closedTabs,
    created,
    saving,
    /** Closes a tab of the workspace showing the page at index of these addresses. */
    close(urls: string[], index: number, workspace = 'work', changes: Partial<TabReopeningTab> = {}) {
      history = { entries: urls.map(page), index }
      rememberClosedTab(access, {
        id: 'tab', url: urls[index]!, title: `Title ${index}`, pinned: false, zoomIsolated: false, tabMuted: false,
        tabAgentPaused: false, humanInteractionLocked: false, mcpGroupId: workspace, ...changes
      })
    },
    reopen: async () => {
      await reopenClosedTabEntry(access, undefined, true)
      return created.at(-1)!
    }
  }
}

describe('the recently closed tabs a restart keeps', () => {
  it('keeps each closed workspace tab with its Back and Forward history, as Chrome', () => {
    const tabs = browser()
    tabs.close([address('a'), address('b'), address('c')], 1, 'work', { label: 'Checkout', tabMuted: true, pinned: true })
    const [saved] = savedClosedTabs(tabs.saving)
    expect(saved!.closed).toMatchObject({ url: address('b'), title: 'Title 1', label: 'Checkout', muted: true, pinned: true, mcpGroupId: 'work' })
    expect(saved!.history).toEqual({ entries: [address('a'), address('b'), address('c')].map(page), index: 1 })
  })

  it('leaves out closed tabs whose workspace is gone, at an address its rules deny, or at an address too long', () => {
    const tabs = browser({ work: anywhere, shop: shopOnly })
    tabs.close([address('kept')], 0)
    tabs.close([address('gone')], 0, 'deleted')
    tabs.close(['https://other.test/denied'], 0, 'shop')
    tabs.close([`data:text/html,${'x'.repeat(64 * 1024)}`], 0)
    expect(savedClosedTabs(tabs.saving).map(({ closed }) => closed.url)).toEqual([address('kept')])
  })

  it('leaves out the pages of a closed tab\'s history its workspace\'s rules deny', () => {
    const tabs = browser({ shop: shopOnly })
    tabs.close([address('a'), 'https://other.test/', address('b')], 2, 'shop')
    expect(savedClosedTabs(tabs.saving)[0]!.history).toEqual({ entries: [page(address('a')), page(address('b'))], index: 1 })
  })

  it('brings back only the closed tabs of workspaces open again, at addresses their rules allow now', () => {
    const tabs = browser({ work: anywhere, shop: anywhere })
    tabs.close([address('a'), 'https://other.test/', address('b')], 2, 'shop')
    tabs.close([address('c')], 0, 'work')
    tabs.close(['https://other.test/denied-now'], 0, 'shop')
    const saved = savedClosedTabs(tabs.saving)
    const restored = restoredClosedTabs(saved, (workspaceId) => workspaceId === 'shop' ? shopOnly : undefined)
    expect(restored.map(({ closed }) => closed.url)).toEqual([address('b')])
    expect(restored[0]!.history).toEqual({ entries: [page(address('a')), page(address('b'))], index: 1 })
  })

  it('reopens a closed tab kept from the last start with its history, without counting another visit', async () => {
    // Recently closed was empty after a restart, and Reopen closed tab had nothing to bring back.
    const before = browser()
    before.close([address('a'), address('b')], 1)
    before.close([address('c')], 0)
    const saved = savedClosedTabs(before.saving)

    const after = browser()
    after.close([address('closed-since')], 0)
    rememberSavedClosedTabs(after.closedTabs, saved)
    expect(after.closedTabs.map((closed) => closed.url)).toEqual([address('b'), address('c'), address('closed-since')])
    await after.reopen()
    await after.reopen()
    expect(after.created[1]).toMatchObject({ url: address('c'), mcpGroupId: 'work' })
    expect(await after.reopen()).toMatchObject({
      url: address('b'),
      suppressInitialHistory: true,
      navigationHistory: { entries: [page(address('a')), page(address('b'))], index: 1 }
    })
  })

  it('keeps no more closed tabs than Recently closed remembers, the newest', () => {
    const tabs = browser()
    for (let index = 0; index < 60; index += 1) tabs.close([address(`p${index}`)], 0)
    const saved = savedClosedTabs(tabs.saving)
    expect(saved.map(({ closed }) => closed.url)).toEqual(Array.from({ length: 50 }, (_value, index) => address(`p${index + 10}`)))
    const later = browser()
    later.close([address('since-1')], 0)
    later.close([address('since-2')], 0)
    rememberSavedClosedTabs(later.closedTabs, saved)
    // The tabs closed since the start are the newest, so the oldest saved ones go.
    expect(later.closedTabs).toHaveLength(50)
    expect(later.closedTabs[0]!.url).toBe(address('p12'))
    expect(later.closedTabs.slice(-2).map((closed) => closed.url)).toEqual([address('since-1'), address('since-2')])
  })

  it('counts a visit on reopening only for a page History had not counted before the restart', async () => {
    // A page that keeps no history, as one a form posted to, came back after a restart as another visit.
    const posted = Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.from(`${address('posted')}application/x-www-form-urlencoded`, 'utf16le')]).toString('base64')
    const before = browser()
    before.close([address('loading')], 0, 'work', { pendingHistoryUrl: address('loading') })
    before.close([address('posted')], 0)
    const saved = savedClosedTabs(before.saving)
    expect(saved.map(({ visited }) => visited)).toEqual([undefined, true])

    const after = browser()
    rememberSavedClosedTabs(after.closedTabs, [{ ...saved[0]! }, { closed: saved[1]!.closed, visited: true }])
    expect(await after.reopen()).toMatchObject({ url: address('posted'), suppressInitialHistory: true })
    expect(after.created[0]).not.toHaveProperty('navigationHistory')
    const loading = await after.reopen()
    expect(loading.url).toBe(address('loading'))
    expect(loading.suppressInitialHistory).toBe(false)
    expect(posted).not.toBe('')
  })

  it('keeps no saved state of a page a form posted to, whose fields it holds, passwords included', () => {
    const tabs = browser()
    const posted = Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.from(`${address('b')}application/x-www-form-urlencoded password=hunter2`, 'utf16le')]).toString('base64')
    tabs.close([address('a'), address('b')], 1)
    const [closed] = tabs.closedTabs
    closedTabHistory(closed!)!.pages!.entries[1]!.pageState = posted
    const [saved] = savedClosedTabs(tabs.saving)
    expect(saved!.history!.entries[1]).toEqual({ url: address('b'), title: 'b' })
    expect(JSON.stringify(saved)).not.toContain(posted)
  })
})

describe('the saved recently closed tabs file', () => {
  it('keeps Recently closed for the next start, readable only by the person', async () => {
    const path = join(await directory(), 'closed-tabs.json')
    const tabs = browser()
    tabs.close([address('a'), address('b')], 1, 'work', { label: 'Label', tabAgentPaused: true, humanInteractionLocked: true, zoomIsolated: true, defaultFontSize: 20 })
    const saved = savedClosedTabs(tabs.saving)
    await new ClosedTabsStore(path).save(() => saved)
    expect((await lstat(path)).mode & 0o777).toBe(0o600)
    expect(await new ClosedTabsStore(path).load()).toEqual(saved)
  })

  it('writes only when Recently closed changed, and nothing once the browser closes', async () => {
    const path = join(await directory(), 'closed-tabs.json')
    const tabs = browser()
    tabs.close([address('a')], 0)
    const store = new ClosedTabsStore(path)
    await store.save(() => savedClosedTabs(tabs.saving))
    const first = await lstat(path)
    await store.save(() => savedClosedTabs(tabs.saving))
    expect((await lstat(path)).mtimeMs).toBe(first.mtimeMs)
    tabs.close([address('b')], 0)
    await store.save(() => undefined)
    expect(JSON.parse(await readFile(path, 'utf8')).closedTabs).toHaveLength(1)
    await store.save(() => savedClosedTabs(tabs.saving))
    expect(JSON.parse(await readFile(path, 'utf8')).closedTabs).toHaveLength(2)
  })

  it('starts Recently closed empty when the file is missing, unreadable, a link or not a saved Recently closed', async () => {
    const root = await directory()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await new ClosedTabsStore(join(root, 'missing.json')).load()).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    await writeFile(join(root, 'broken.json'), '{')
    await writeFile(join(root, 'other.json'), JSON.stringify({ version: 2, closedTabs: [] }))
    const tabs = browser()
    tabs.close([address('a')], 0)
    await new ClosedTabsStore(join(root, 'real.json')).save(() => savedClosedTabs(tabs.saving))
    await symlink(join(root, 'real.json'), join(root, 'link.json'))
    for (const name of ['broken.json', 'other.json', 'link.json']) expect(await new ClosedTabsStore(join(root, name)).load()).toEqual([])
    expect(warn.mock.calls).toEqual(Array.from({ length: 3 }, () => ['[browser] The saved recently closed tabs could not be read; Recently closed starts empty.']))
  })

  it('skips a closed tab that is not one, or whose history is not one, and keeps the others', async () => {
    const path = join(await directory(), 'closed-tabs.json')
    const tabs = browser()
    tabs.close([address('a'), address('b')], 1)
    const [good] = savedClosedTabs(tabs.saving) as [SavedClosedTab]
    const bad = [
      { closed: { ...good.closed, id: 'not-a-uuid' } },
      { closed: { ...good.closed, closedAt: 'yesterday' } },
      { closed: { ...good.closed, mcpGroupId: undefined } },
      { closed: { ...good.closed, place: 50 } },
      { closed: good.closed, history: { entries: [], index: 0 } },
      { closed: good.closed, history: { entries: good.history!.entries, index: 2 } },
      { closed: good.closed, history: { entries: Array.from({ length: 14 }, () => good.history!.entries[0]), index: 0 } },
      'tab'
    ]
    await writeFile(path, JSON.stringify({ version: 1, closedTabs: [...bad, good] }))
    expect(await new ClosedTabsStore(path).load()).toEqual([good])
  })

  it('keeps a title too long only in part, and no label a tab could not have, as a saved tab comes back', async () => {
    const path = join(await directory(), 'closed-tabs.json')
    const tabs = browser()
    tabs.close([address('a')], 0)
    const [good] = savedClosedTabs(tabs.saving) as [SavedClosedTab]
    await writeFile(path, JSON.stringify({ version: 1, closedTabs: [
      { closed: { ...good.closed, title: 'T'.repeat(5000), label: 'L'.repeat(500) } },
      { closed: { ...good.closed, label: '  Checkout  ' } }
    ] }))
    const [long, trimmed] = await new ClosedTabsStore(path).load()
    expect(long!.closed.title.length).toBeLessThan(5000)
    expect(long!.closed).not.toHaveProperty('label')
    expect(trimmed!.closed.label).toBe('Checkout')
  })
})

describe('the tab manager saving Recently closed', () => {
  it('saves it without the closed tabs whose history was cleared at once', async () => {
    // A cleared page stayed on disk in Recently closed until the next save.
    const tabs = browser()
    tabs.close([address('a')], 0)
    tabs.close([address('cleared')], 0)
    const saved: (readonly SavedClosedTab[] | undefined)[] = []
    const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
      closedTabs: tabs.closedTabs,
      detachedClosedTabs: new Set(),
      tabs: new Map(),
      mcpTabGroups: new Map([['work', { navigationPolicy: anywhere }]]),
      workspacesBeingDeleted: new Map(),
      initialized: true,
      destroyed: false,
      changed: vi.fn(),
      closedTabsStore: { save: async (closedTabs: () => readonly SavedClosedTab[] | undefined) => { saved.push(closedTabs()) } }
    }) as BrowserTabsManager
    manager.forgetHistoryPages((url) => url === address('cleared'))
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]!.map(({ closed }) => closed.url)).toEqual([address('a')])
  })

  it('saves a kept closed tab without the Back pages whose history was cleared', async () => {
    const tabs = browser()
    tabs.close([address('cleared'), address('kept')], 1)
    const saved: (readonly SavedClosedTab[] | undefined)[] = []
    const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
      closedTabs: tabs.closedTabs,
      detachedClosedTabs: new Set(),
      tabs: new Map(),
      mcpTabGroups: new Map([['work', { navigationPolicy: anywhere }]]),
      workspacesBeingDeleted: new Map(),
      initialized: true,
      destroyed: false,
      changed: vi.fn(),
      closedTabsStore: { save: async (closedTabs: () => readonly SavedClosedTab[] | undefined) => { saved.push(closedTabs()) } }
    }) as BrowserTabsManager
    // Saved once with the page, as every few seconds, and then once its history is cleared.
    await (manager as unknown as { saveForNextStart(): Promise<void> }).saveForNextStart()
    manager.forgetHistoryPages((url) => url === address('cleared'))
    await vi.waitFor(() => expect(saved).toHaveLength(2))
    expect(JSON.stringify(saved[0])).toContain(address('cleared'))
    expect(saved[1]!.map(({ closed }) => closed.url)).toEqual([address('kept')])
    expect(JSON.stringify(saved[1])).not.toContain(address('cleared'))
  })

  it('removes the saved Recently closed when the history is cleared before the saved tabs are back', async () => {
    const discard = vi.fn(async () => undefined)
    const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
      closedTabs: [],
      detachedClosedTabs: new Set(),
      tabs: new Map(),
      mcpTabGroups: new Map(),
      initialized: false,
      destroyed: false,
      changed: vi.fn(),
      closedTabsStore: { discard, save: vi.fn() }
    }) as BrowserTabsManager
    manager.forgetHistoryPages(() => true)
    expect(discard).toHaveBeenCalledOnce()
  })

  it('leaves out the closed tabs of a workspace being deleted', () => {
    const tabs = browser()
    tabs.close([address('a')], 0)
    const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
      closedTabs: tabs.closedTabs,
      mcpTabGroups: new Map([['work', { navigationPolicy: anywhere }]]),
      workspacesBeingDeleted: new Map([['work', {}]])
    }) as BrowserTabsManager
    const access = (manager as unknown as { savedClosedTabsAccess(): SavedClosedTabsAccess }).savedClosedTabsAccess()
    expect(savedClosedTabs(access)).toEqual([])
  })
})
