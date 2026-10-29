import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'

const built = vi.hoisted(() => ({ templates: [] as MenuItemConstructorOptions[][] }))
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (template: MenuItemConstructorOptions[]) => { built.templates.push(template); return { popup: () => undefined } } }
}))

const { showTabContextMenu } = await import('../src/main/browser/context-menus/tab-context-menu.js')

const tab = (id: string, mcpGroupId?: string, url = `https://${id}.test/`) => ({
  id, title: id, url, mcpGroupId, pinned: false, sleeping: false, loading: false, muted: false,
  pageLifecycleState: 'active' as const, webContents: { isDestroyed: () => false }
})

/** The menu's view of the tab manager, with the tab rail showing every workspace's tabs. */
function access(tabs: ReturnType<typeof tab>[], activeTabId: string) {
  const send = vi.fn()
  const groups = new Map(tabs.flatMap(({ mcpGroupId }) => mcpGroupId ? [[mcpGroupId, { id: mcpGroupId, name: mcpGroupId }] as const] : []))
  return {
    send,
    access: {
      getTab: (id?: string) => tabs.find((candidate) => candidate.id === (id ?? activeTabId))!,
      orderedTabs: () => tabs,
      activeTabId: () => activeTabId,
      findTab: (id: string) => tabs.find((candidate) => candidate.id === id),
      options: () => ({ getTabPosition: () => 'top', onActionFailed: vi.fn() }),
      mcpTabGroups: () => groups,
      text: (key: string) => key,
      workspaceContextMenuItems: () => [],
      splitViewContains: () => false,
      splitView: () => null,
      reactInspectionController: () => ({ status: () => ({ enabled: false, status: 'disabled' }) }),
      sleepBlockReason: () => undefined,
      sleepFallbackTab: () => undefined,
      canMuteSite: () => false,
      isSiteMuted: () => false,
      closedTabs: () => [],
      window: () => ({ webContents: { send } })
    } as never
  }
}

describe('New Tab in a tab\'s menu', () => {
  // It opened the tab in the workspace of the active tab, which differs when the rail shows another workspace's tab.
  it('asks the window for a new tab in the workspace of the tab whose menu it is', () => {
    const { access: menuAccess, send } = access([tab('home', undefined, 'hronaut://home/'), tab('own', 'own'), tab('client', 'client')], 'own')
    showTabContextMenu(menuAccess, 'client')
    const item = built.templates.at(-1)!.find((candidate) => candidate.id === 'new-tab')!
    ;(item.click as () => void)()
    expect(send).toHaveBeenCalledExactlyOnceWith('browser:new-tab-requested', 'client')
  })
})

describe('Bookmark All Tabs in a tab\'s menu', () => {
  it('asks the window to bookmark the tabs of the workspace of the tab whose menu it is', () => {
    const { access: menuAccess, send } = access([tab('home', undefined, 'hronaut://home/'), tab('own', 'own'), tab('client', 'client'), tab('loose')], 'own')
    showTabContextMenu(menuAccess, 'client')
    const item = built.templates.at(-1)!.find((candidate) => candidate.id === 'bookmark-all-tabs')!
    expect(item).toMatchObject({ label: 'native.context.bookmarkAllTabs', enabled: true })
    ;(item.click as () => void)()
    expect(send).toHaveBeenCalledExactlyOnceWith('browser:bookmark-all-tabs-requested', 'client')
    // The tabs in no workspace are named by null.
    showTabContextMenu(menuAccess, 'loose')
    ;(built.templates.at(-1)!.find((candidate) => candidate.id === 'bookmark-all-tabs')!.click as () => void)()
    expect(send).toHaveBeenLastCalledWith('browser:bookmark-all-tabs-requested', null)
  })

  it('is unavailable while none of the workspace\'s tabs shows a web page', () => {
    const { access: menuAccess } = access([tab('blank', 'client', 'about:blank'), tab('site', 'other')], 'blank')
    showTabContextMenu(menuAccess, 'blank')
    expect(built.templates.at(-1)!.find((candidate) => candidate.id === 'bookmark-all-tabs')).toMatchObject({ enabled: false })
  })
})
