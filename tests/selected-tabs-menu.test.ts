import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'

const built = vi.hoisted(() => ({ templates: [] as MenuItemConstructorOptions[][] }))
vi.mock('electron', () => ({
  session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' },
  Menu: { buildFromTemplate: (template: MenuItemConstructorOptions[]) => { built.templates.push(template); return { popup: () => undefined } } }
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

/** The menu's view of the tab manager, recording each tab command it runs in order. */
function access(tabs: Tab[], activeTabId = tabs[0]!.id) {
  const calls: string[] = []
  const record = (name: string) => vi.fn(async (...args: unknown[]) => { calls.push(`${name} ${args.join(' ')}`); return {} })
  const send = vi.fn()
  const groups = new Map([['work', { id: 'work', name: 'Work' }], ['other', { id: 'other', name: 'Other' }]])
  return {
    calls,
    send,
    access: {
      getTab: (id?: string) => tabs.find((candidate) => candidate.id === (id ?? activeTabId))!,
      orderedTabs: () => [...tabs],
      activeTabId: () => activeTabId,
      findTab: (id: string) => tabs.find((candidate) => candidate.id === id),
      options: () => ({ getTabPosition: () => 'top', onActionFailed: vi.fn() }),
      mcpTabGroups: () => groups,
      text: (key: string) => key,
      workspaceContextMenuItems: () => [{ id: 'edit-workspace' }],
      splitViewContains: () => false,
      splitView: () => null,
      reactInspectionController: () => ({ status: () => ({ enabled: false, status: 'disabled' }) }),
      sleepBlockReason: () => undefined,
      sleepFallbackTab: () => undefined,
      canMuteSite: () => false,
      isSiteMuted: () => false,
      reload: record('reload'),
      duplicateTab: record('duplicate'),
      setTabMuted: vi.fn((id: string, muted: boolean) => { calls.push(`mute ${id} ${muted}`); return {} }),
      setTabPinned: record('pin'),
      closeTabsForPerson: vi.fn(async (ids: readonly string[]) => { calls.push(`close ${ids.join(',')}`); return {} }),
      closedTabs: () => [{}],
      reopenClosedTab: record('reopen'),
      window: () => ({ webContents: { send } })
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
    const fake = access(tabs)
    showTabContextMenu(fake.access, 'c', undefined, ['b', 'c'])
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
    const fake = access([tab('a', 'work', { muted: true, pinned: true }), tab('b', 'work', { muted: true, pinned: true }), tab('c')])
    showTabContextMenu(fake.access, 'a', undefined, ['a', 'b'])
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
    const fake = access(tabs)
    showTabContextMenu(fake.access, 'a', undefined, ['a', 'b', 'c'])
    tabs.splice(1, 1)
    await click('close-tabs')
    expect(fake.calls).toEqual(['close a,c'])
  })

  it('skips a tab closed, pinned or unpinned while the tabs before it are duplicated or pinned', async () => {
    const tabs = [tab('a'), tab('b'), tab('c')]
    const fake = access(tabs)
    const duplicate = (fake.access as { duplicateTab: (id: string) => Promise<unknown> }).duplicateTab
    Object.assign(fake.access, {
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
    showTabContextMenu(fake.access, 'a', undefined, ['a', 'b', 'c'])
    await click('duplicate-tabs')
    expect(fake.calls).toEqual(['duplicate a', 'duplicate c'])

    tabs.splice(1, 0, tab('b'))
    fake.calls.length = 0
    showTabContextMenu(fake.access, 'a', undefined, ['a', 'b', 'c'])
    await click('pin-tabs')
    expect(fake.calls).toEqual(['pin a true', 'pin b true'])
  })

  it('is the tab\'s own menu when the tab is not selected, or fewer than two selected tabs are open in its workspace', async () => {
    const fake = access([tab('home', undefined), tab('a'), tab('b'), tab('x', 'other')])
    for (const [tabId, selected] of [['a', ['b', 'x']], ['a', ['a', 'x']], ['a', ['a', 'home']], ['a', ['a', 'gone']], ['a', undefined]] as const) {
      showTabContextMenu(fake.access, tabId, undefined, selected as readonly string[] | undefined)
      expect(ids()).toContain('close-tab')
      expect(ids()).not.toContain('close-tabs')
    }
    // Tabs of another workspace are left out of the selection's menu.
    showTabContextMenu(fake.access, 'a', undefined, ['a', 'b', 'x'])
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
    const fake = access([], 'a')
    Object.assign(fake.access, {
      orderedTabs: () => orderedTabs(manager as never),
      getTab: (id: string) => manager.tabs.get(id),
      findTab: (id: string) => manager.tabs.get(id),
      setTabPinned: (id: string, pinned: boolean) => manager.setTabPinned(id, pinned)
    })

    showTabContextMenu(fake.access, 'b', undefined, ['b', 'd'])
    await click('pin-tabs')
    expect(order()).toEqual(['p*', 'b*', 'd*', 'a', 'c'])

    showTabContextMenu(fake.access, 'b', undefined, ['b', 'd'])
    await click('unpin-tabs')
    expect(order()).toEqual(['p*', 'b', 'd', 'a', 'c'])

    // A selection of pinned and unpinned tabs pins the others.
    showTabContextMenu(fake.access, 'p', undefined, ['p', 'a', 'c'])
    await click('pin-tabs')
    expect(order()).toEqual(['p*', 'a*', 'c*', 'b', 'd'])
  })
})
