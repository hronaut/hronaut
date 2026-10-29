import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'

const built = vi.hoisted(() => ({ templates: [] as MenuItemConstructorOptions[][] }))
vi.mock('electron', () => ({
  session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' },
  Menu: { buildFromTemplate: (template: MenuItemConstructorOptions[]) => { built.templates.push(template); return { popup: () => undefined } } }
}))
// The prototype-built browsers below stub changed and getState; the arrangement functions publish through these.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))

// The browser below stubs workspaceContextMenuItems, sleepBlockReason, sleepFallbackTab, canMuteSite and isSiteMuted, which
// the menu asks through these.
vi.mock('../src/main/browser/context-menus/workspace-context-menu.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/context-menus/workspace-context-menu.js')>(),
  workspaceContextMenuItems: (browser: { workspaceContextMenuItems: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.workspaceContextMenuItems(...args)
}))
vi.mock('../src/main/browser/tab-sleep/tab-sleep.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-sleep/tab-sleep.js')>(),
  sleepBlockReason: (browser: { sleepBlockReason: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.sleepBlockReason(...args),
  sleepFallbackTab: (browser: { sleepFallbackTab: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.sleepFallbackTab(...args)
}))
vi.mock('../src/main/browser/site-muting/site-muting.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/site-muting/site-muting.js')>(),
  canMuteSite: (browser: { canMuteSite: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.canMuteSite(...args),
  isSiteMuted: (browser: { isSiteMuted: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.isSiteMuted(...args)
}))

const { showTabContextMenu } = await import('../src/main/browser/context-menus/tab-context-menu.js')
const { Browser } = await import('../src/main/browser/browser.js')
const { orderedTabs } = await import('../src/main/browser/browser-core.js')

// A tab menu opened on one of several tabs selected with Ctrl or Shift and a click acted only on that tab; as in
// Chrome, it acts on every selected tab.

interface Tab {
  id: string; title: string; url: string; mcpGroupId?: string; pinned: boolean; sleeping: boolean; loading: boolean; muted: boolean
  pageLifecycleState: 'active'; webContents: { isDestroyed: () => boolean }
}

const tab = (id: string, mcpGroupId: string | undefined = 'work', options: Partial<Tab> = {}): Tab => ({
  id, title: id, url: id === 'home' ? 'hronaut://home/' : `https://${id}.test/`, mcpGroupId, pinned: false, sleeping: false,
  loading: false, muted: false, pageLifecycleState: 'active', webContents: { isDestroyed: () => false }, ...options
})

/** The browser as the menu sees it, recording each tab command it runs in order. */
function menuBrowser(tabs: Tab[], activeTabId = tabs[0]!.id) {
  const calls: string[] = []
  const record = (name: string) => vi.fn(async (...args: unknown[]) => { calls.push(`${name} ${args.join(' ')}`); return {} })
  const send = vi.fn()
  const groups = new Map([['work', { id: 'work', name: 'Work' }], ['other', { id: 'other', name: 'Other' }]])
  return {
    calls,
    send,
    browser: {
      // The tabs as they are now, in the order the strip shows them.
      get tabs() { return new Map(tabs.map((candidate) => [candidate.id, candidate])) },
      activeTabId,
      options: { getTabPosition: () => 'top', onActionFailed: vi.fn() },
      mcpTabGroups: groups,
      text: (key: string) => key,
      workspaceContextMenuItems: () => [{ id: 'edit-workspace' }],
      splitViewContains: () => false,
      splitView: null,
      reactInspectionController: { status: () => ({ enabled: false, status: 'disabled' }) },
      sleepBlockReason: () => undefined,
      sleepFallbackTab: () => undefined,
      canMuteSite: () => false,
      isSiteMuted: () => false,
      reload: record('reload'),
      duplicateTab: record('duplicate'),
      setTabMuted: vi.fn((id: string, muted: boolean) => { calls.push(`mute ${id} ${muted}`); return {} }),
      setTabPinned: record('pin'),
      closeTabsForPerson: vi.fn(async (ids: readonly string[]) => { calls.push(`close ${ids.join(',')}`); return {} }),
      closedTabs: [{}],
      reopenClosedTab: record('reopen'),
      window: { webContents: { send } }
    } as never
  }
}

const menu = () => built.templates.at(-1)!
const ids = () => menu().map((item) => item.type === 'separator' ? '|' : item.id)
const item = (id: string) => menu().find((candidate) => candidate.id === id)!
const click = async (id: string) => {
  ;(item(id).click as () => void)()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('the tab menu of several selected tabs', () => {
  it('acts on every selected tab: reload, duplicate, mute, close, the other tabs and those after them', async () => {
    const tabs = [tab('a'), tab('b'), tab('c'), tab('d'), tab('e')]
    const fake = menuBrowser(tabs)
    showTabContextMenu(fake.browser, 'c', undefined, ['b', 'c'])
    expect(ids()).toEqual([
      'new-tab', 'reload-tabs', 'duplicate-tabs', '|', 'mute-tabs', 'pin-tabs', 'workspace', '|',
      'close-tabs', 'close-other-tabs', 'close-tabs-to-right', '|', 'reopen-closed-tab', 'bookmark-all-tabs'
    ])
    expect(item('reload-tabs').label).toBe('native.context.reloadTabs')
    expect(item('close-tabs').label).toBe('native.context.closeTabs')
    expect(item('workspace').submenu).toEqual([{ id: 'edit-workspace' }])

    await click('reload-tabs')
    await click('duplicate-tabs')
    await click('mute-tabs')
    await click('close-tabs')
    await click('close-other-tabs')
    await click('close-tabs-to-right')
    // In the strip's order, whatever order the shell named them in.
    expect(fake.calls).toEqual([
      'reload b', 'reload c', 'duplicate b', 'duplicate c', 'mute b true', 'mute c true',
      'close b,c', 'close a,d,e', 'close d,e'
    ])
  })

  it('unmutes and unpins when every selected tab is muted or pinned, and new tab opens in their workspace', async () => {
    const fake = menuBrowser([tab('a', 'work', { muted: true, pinned: true }), tab('b', 'work', { muted: true, pinned: true }), tab('c')])
    showTabContextMenu(fake.browser, 'a', undefined, ['a', 'b'])
    expect(ids()).toContain('unmute-tabs')
    expect(ids()).toContain('unpin-tabs')
    expect(item('unpin-tabs').label).toBe('native.context.unpinTabs')
    // Pinned tabs are not closed as the others or as those after them.
    expect(item('close-other-tabs').enabled).toBe(true)
    await click('unmute-tabs')
    await click('new-tab')
    expect(fake.calls).toEqual(['mute a false', 'mute b false'])
    expect(fake.send).toHaveBeenCalledExactlyOnceWith('browser:new-tab-requested', 'work')
  })

  it('acts only on the selected tabs still open when an item is chosen', async () => {
    const tabs = [tab('a'), tab('b'), tab('c')]
    const fake = menuBrowser(tabs)
    showTabContextMenu(fake.browser, 'a', undefined, ['a', 'b', 'c'])
    tabs.splice(1, 1)
    await click('close-tabs')
    expect(fake.calls).toEqual(['close a,c'])
  })

  it('skips a tab closed, pinned or unpinned while the tabs before it are duplicated or pinned', async () => {
    const tabs = [tab('a'), tab('b'), tab('c')]
    const fake = menuBrowser(tabs)
    const duplicate = (fake.browser as { duplicateTab: (id: string) => Promise<unknown> }).duplicateTab
    Object.assign(fake.browser, {
      duplicateTab: async (id: string) => {
        await duplicate(id)
        // Closing the next tab while the first copy opens.
        if (id === 'a') tabs.splice(1, 1)
      },
      setTabPinned: async (id: string, pinned: boolean) => {
        fake.calls.push(`pin ${id} ${pinned}`)
        tabs.find((candidate) => candidate.id === id)!.pinned = pinned
        // Another window pins the last tab while the first is pinned.
        if (id === 'a') tabs.find((candidate) => candidate.id === 'c')!.pinned = true
      }
    })
    showTabContextMenu(fake.browser, 'a', undefined, ['a', 'b', 'c'])
    await click('duplicate-tabs')
    expect(fake.calls).toEqual(['duplicate a', 'duplicate c'])

    tabs.splice(1, 0, tab('b'))
    fake.calls.length = 0
    showTabContextMenu(fake.browser, 'a', undefined, ['a', 'b', 'c'])
    await click('pin-tabs')
    expect(fake.calls).toEqual(['pin a true', 'pin b true'])
  })

  it('is the tab\'s own menu when the tab is not selected, or fewer than two selected tabs are open in its workspace', async () => {
    const fake = menuBrowser([tab('home', undefined), tab('a'), tab('b'), tab('x', 'other')])
    for (const [tabId, selected] of [['a', ['b', 'x']], ['a', ['a', 'x']], ['a', ['a', 'home']], ['a', ['a', 'gone']], ['a', undefined]] as const) {
      showTabContextMenu(fake.browser, tabId, undefined, selected as readonly string[] | undefined)
      expect(ids()).toContain('close-tab')
      expect(ids()).not.toContain('close-tabs')
    }
    // Tabs of another workspace are left out of the selection's menu.
    showTabContextMenu(fake.browser, 'a', undefined, ['a', 'b', 'x'])
    expect(ids()).toContain('close-tabs')
    await click('close-tabs')
    expect(fake.calls).toEqual(['close a,b'])
  })

  it('pins and unpins the tabs in the order they had, as Chrome does', async () => {
    const manager = Object.assign(Object.create(Browser.prototype), {
      mcpTabGroups: new Map([['work', { id: 'work', name: 'Work' }]]),
      tabs: new Map(['p', 'a', 'b', 'c', 'd'].map((id) => [id, tab(id, 'work', { pinned: id === 'p' })])),
      activeTabId: 'a',
      splitView: null,
      changed: () => undefined,
      getState: () => ({})
    }) as { tabs: Map<string, Tab>; setTabPinned(id: string, pinned: boolean): Promise<unknown> }
    const order = () => orderedTabs(manager as never).map((candidate) => `${candidate.id}${candidate.pinned ? '*' : ''}`)
    const fake = menuBrowser([], 'a')
    // The menu reads the tabs of the browser that pins them.
    Object.defineProperty(fake.browser, 'tabs', { get: () => manager.tabs })
    Object.assign(fake.browser, { setTabPinned: (id: string, pinned: boolean) => manager.setTabPinned(id, pinned) })

    showTabContextMenu(fake.browser, 'b', undefined, ['b', 'd'])
    await click('pin-tabs')
    expect(order()).toEqual(['p*', 'b*', 'd*', 'a', 'c'])

    showTabContextMenu(fake.browser, 'b', undefined, ['b', 'd'])
    await click('unpin-tabs')
    expect(order()).toEqual(['p*', 'b', 'd', 'a', 'c'])

    // A selection of pinned and unpinned tabs pins the others.
    showTabContextMenu(fake.browser, 'p', undefined, ['p', 'a', 'c'])
    await click('pin-tabs')
    expect(order()).toEqual(['p*', 'a*', 'c*', 'b', 'd'])
  })
})
