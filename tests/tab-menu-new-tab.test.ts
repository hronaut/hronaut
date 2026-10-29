import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'

const built = vi.hoisted(() => ({ templates: [] as MenuItemConstructorOptions[][] }))
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (template: MenuItemConstructorOptions[]) => { built.templates.push(template); return { popup: () => undefined } } }
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

const tab = (id: string, mcpGroupId?: string, url = `https://${id}.test/`) => ({
  id, title: id, url, mcpGroupId, pinned: false, sleeping: false, loading: false, muted: false,
  pageLifecycleState: 'active' as const, webContents: { isDestroyed: () => false }
})

/** The browser as the menu sees it, with the tab rail showing every workspace's tabs. */
function menuBrowser(tabs: ReturnType<typeof tab>[], activeTabId: string) {
  const send = vi.fn()
  const groups = new Map(tabs.flatMap(({ mcpGroupId }) => mcpGroupId ? [[mcpGroupId, { id: mcpGroupId, name: mcpGroupId }] as const] : []))
  return {
    send,
    browser: {
      // The tabs as they are now, in the order the strip shows them.
      get tabs() { return new Map(tabs.map((candidate) => [candidate.id, candidate])) },
      activeTabId,
      options: { getTabPosition: () => 'top', onActionFailed: vi.fn() },
      mcpTabGroups: groups,
      text: (key: string) => key,
      workspaceContextMenuItems: () => [],
      splitViewContains: () => false,
      splitView: null,
      reactInspectionController: { status: () => ({ enabled: false, status: 'disabled' }) },
      sleepBlockReason: () => undefined,
      sleepFallbackTab: () => undefined,
      canMuteSite: () => false,
      isSiteMuted: () => false,
      closedTabs: [],
      window: { webContents: { send } }
    } as never
  }
}

describe('New Tab in a tab\'s menu', () => {
  // It opened the tab in the workspace of the active tab, which differs when the rail shows another workspace's tab.
  it('asks the window for a new tab in the workspace of the tab whose menu it is', () => {
    const { browser: menuBrowserFake, send } = menuBrowser([tab('home', undefined, 'hronaut://home/'), tab('own', 'own'), tab('client', 'client')], 'own')
    showTabContextMenu(menuBrowserFake, 'client')
    const item = built.templates.at(-1)!.find((candidate) => candidate.id === 'new-tab')!
    ;(item.click as () => void)()
    expect(send).toHaveBeenCalledExactlyOnceWith('browser:new-tab-requested', 'client')
  })
})

describe('Bookmark All Tabs in a tab\'s menu', () => {
  it('asks the window to bookmark the tabs of the workspace of the tab whose menu it is', () => {
    const { browser: menuBrowserFake, send } = menuBrowser([tab('home', undefined, 'hronaut://home/'), tab('own', 'own'), tab('client', 'client'), tab('loose')], 'own')
    showTabContextMenu(menuBrowserFake, 'client')
    const item = built.templates.at(-1)!.find((candidate) => candidate.id === 'bookmark-all-tabs')!
    expect(item).toMatchObject({ label: 'native.context.bookmarkAllTabs', enabled: true })
    ;(item.click as () => void)()
    expect(send).toHaveBeenCalledExactlyOnceWith('browser:bookmark-all-tabs-requested', 'client')
    // The tabs in no workspace are named by null.
    showTabContextMenu(menuBrowserFake, 'loose')
    ;(built.templates.at(-1)!.find((candidate) => candidate.id === 'bookmark-all-tabs')!.click as () => void)()
    expect(send).toHaveBeenLastCalledWith('browser:bookmark-all-tabs-requested', null)
  })

  it('is unavailable while none of the workspace\'s tabs shows a web page', () => {
    const { browser: menuBrowserFake } = menuBrowser([tab('blank', 'client', 'about:blank'), tab('site', 'other')], 'blank')
    showTabContextMenu(menuBrowserFake, 'blank')
    expect(built.templates.at(-1)!.find((candidate) => candidate.id === 'bookmark-all-tabs')).toMatchObject({ enabled: false })
  })
})
