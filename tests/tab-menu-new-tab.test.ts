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
