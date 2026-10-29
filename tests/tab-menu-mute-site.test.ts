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

/** The menu's view of the tab manager, with the tab rail showing every workspace's tabs and the websites muted. */
function access(tabs: ReturnType<typeof tab>[], activeTabId: string, mutedSites = new Set<string>()) {
  const send = vi.fn()
  const setSiteMuted = vi.fn(() => Promise.resolve({}))
  const groups = new Map(tabs.flatMap(({ mcpGroupId }) => mcpGroupId ? [[mcpGroupId, { id: mcpGroupId, name: mcpGroupId }] as const] : []))
  return {
    send,
    setSiteMuted,
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
      canMuteSite: (candidate: { url: string; mcpGroupId?: string }) => /^https?:/.test(candidate.url) && candidate.mcpGroupId !== undefined,
      isSiteMuted: (candidate: { url: string }) => mutedSites.has(new URL(candidate.url).origin),
      setSiteMuted,
      closedTabs: () => [],
      window: () => ({ webContents: { send } })
    } as never
  }
}

// Chrome's Mute Site and Unmute Site, after Mute Tab in a tab's menu, for a website in a workspace.
const items = () => built.templates.at(-1)!.filter((item) => item.type !== 'separator').map((item) => item.id)

describe('Mute Site in a tab\'s menu', () => {
  it('mutes the tab\'s website, and unmutes it once muted', async () => {
    const { access: menuAccess, setSiteMuted } = access([tab('own', 'own'), tab('client', 'client')], 'own')
    showTabContextMenu(menuAccess, 'client')
    expect(items().slice(items().indexOf('mute-tab'), items().indexOf('mute-tab') + 2)).toEqual(['mute-tab', 'mute-site'])
    const mute = built.templates.at(-1)!.find((candidate) => candidate.id === 'mute-site')!
    expect(mute.label).toBe('native.context.muteSite')
    ;(mute.click as () => void)()
    expect(setSiteMuted).toHaveBeenCalledExactlyOnceWith('client', true)

    const muted = access([tab('client', 'client')], 'client', new Set(['https://client.test']))
    showTabContextMenu(muted.access, 'client')
    const unmute = built.templates.at(-1)!.find((candidate) => candidate.id === 'unmute-site')!
    expect(unmute.label).toBe('native.context.unmuteSite')
    ;(unmute.click as () => void)()
    expect(muted.setSiteMuted).toHaveBeenCalledExactlyOnceWith('client', false)
  })

  it('is not there for Home, a page that is no website, or a tab in no workspace', () => {
    const { access: menuAccess } = access([tab('home', undefined, 'hronaut://home/'), tab('data', 'client', 'data:text/html,a'), tab('loose')], 'loose')
    for (const id of ['home', 'data', 'loose']) {
      built.templates.length = 0
      showTabContextMenu(menuAccess, id)
      // Home has no tab menu at all.
      expect(built.templates).toHaveLength(id === 'home' ? 0 : 1)
      for (const template of built.templates) {
        expect(template.map((item) => item.id)).not.toContain('mute-site')
        expect(template.map((item) => item.id)).not.toContain('unmute-site')
      }
    }
  })
})
