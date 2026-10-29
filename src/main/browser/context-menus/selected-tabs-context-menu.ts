import { Menu, type MenuItemConstructorOptions } from 'electron'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { findTab, orderedTabs } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { workspaceContextMenuItems } from './workspace-context-menu.js'

/**
 * The tabs a menu opened on a selected tab acts on, as Chrome's tab menu acts on the tabs selected in its strip: the
 * selected website tabs still open in that tab's workspace, in the order the strip shows them. Fewer than two, as when
 * the tab is not one of them, leaves the menu the tab's own.
 */
export function selectedMenuTabs(browser: Browser, tab: BrowserTab, selectedTabIds: readonly string[] | undefined): BrowserTab[] {
  if (!selectedTabIds?.includes(tab.id)) return []
  const selected = new Set(selectedTabIds)
  const tabs = orderedTabs(browser).filter((candidate) => (
    selected.has(candidate.id) && candidate.mcpGroupId === tab.mcpGroupId && !isHronautHomeUrl(candidate.url)
  ))
  return tabs.length > 1 ? tabs : []
}

/**
 * Shows the menu of several selected tabs, as Chrome does: new tab, reloading, duplicating, muting and pinning them all,
 * the workspace's own menu, closing them, the workspace's other tabs or those after them, reopening a closed tab and
 * bookmarking all tabs. Each action acts on the selected tabs still open when it runs. A failed action is logged and
 * reported, never thrown.
 */
export function showSelectedTabsContextMenu(browser: Browser, tab: BrowserTab, selected: readonly BrowserTab[], onClosed?: () => void): void {
  const workspaceTabs = orderedTabs(browser).filter((candidate) => (
    candidate.mcpGroupId === tab.mcpGroupId && !isHronautHomeUrl(candidate.url)
  ))
  const lastSelectedIndex = workspaceTabs.findLastIndex((candidate) => selected.includes(candidate))
  const otherTabs = workspaceTabs.filter((candidate) => !candidate.pinned && !selected.includes(candidate))
  const tabsToRight = workspaceTabs.slice(lastSelectedIndex + 1).filter((candidate) => !candidate.pinned && !selected.includes(candidate))
  const open = (): BrowserTab[] => selected.filter((candidate) => findTab(browser, candidate.id) === candidate)
  const reportError = (action: string) => (error: unknown): void => {
    console.error(`[browser] Could not ${action} from tab context menu:`, error)
    browser.options.onActionFailed?.(action, error)
  }
  const runAction = (action: string, callback: () => unknown): void => {
    try {
      void Promise.resolve(callback()).catch(reportError(action))
    } catch (error) {
      reportError(action)(error)
    }
  }
  const allMuted = selected.every((candidate) => candidate.muted)
  const allPinned = selected.every((candidate) => candidate.pinned)
  const verticalTabs = browser.options.getTabPosition() === 'left'
  const currentGroup = tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
  const groupMenu: MenuItemConstructorOptions = currentGroup
    ? {
        id: 'workspace',
        label: browser.text('native.context.workspace', { name: currentGroup.name }),
        submenu: workspaceContextMenuItems(browser, currentGroup)
      }
    : {
        id: 'workspace',
        label: browser.text('native.context.workspaceUnavailable'),
        enabled: false
      }
  const menu = Menu.buildFromTemplate([
    {
      id: 'new-tab',
      label: browser.text('native.context.newTab'),
      click: () => runAction('open a new tab', () => browser.window.webContents.send('browser:new-tab-requested', tab.mcpGroupId))
    },
    {
      id: 'reload-tabs',
      label: browser.text('native.context.reloadTabs'),
      click: () => runAction('reload the tabs', () => Promise.all(open().map((candidate) => browser.reload(candidate.id))))
    },
    {
      id: 'duplicate-tabs',
      label: browser.text('native.context.duplicateTabs'),
      // One after another, so each copy opens beside its own tab; a tab closed meanwhile is skipped.
      click: () => runAction('duplicate the tabs', async () => {
        for (const candidate of open()) {
          if (findTab(browser, candidate.id) === candidate) await browser.duplicateTab(candidate.id)
        }
      })
    },
    { type: 'separator' },
    {
      id: allMuted ? 'unmute-tabs' : 'mute-tabs',
      label: browser.text(allMuted ? 'native.context.unmuteTabs' : 'native.context.muteTabs'),
      click: () => runAction(allMuted ? 'unmute the tabs' : 'mute the tabs', () => {
        for (const candidate of open()) browser.setTabMuted(candidate.id, !allMuted)
      })
    },
    {
      id: allPinned ? 'unpin-tabs' : 'pin-tabs',
      label: browser.text(allPinned ? 'native.context.unpinTabs' : 'native.context.pinTabs'),
      // A pinned tab goes after the pinned tabs and an unpinned one before the others, so the tabs keep their order
      // when pinned first to last and unpinned last to first.
      click: () => runAction(allPinned ? 'unpin the tabs' : 'pin the tabs', async () => {
        const tabs = open().filter((candidate) => candidate.pinned === allPinned)
        for (const candidate of allPinned ? tabs.reverse() : tabs) {
          // A tab closed, pinned or unpinned meanwhile is left as it is.
          if (findTab(browser, candidate.id) === candidate && candidate.pinned === allPinned) await browser.setTabPinned(candidate.id, !allPinned)
        }
      })
    },
    groupMenu,
    { type: 'separator' },
    {
      id: 'close-tabs',
      label: browser.text('native.context.closeTabs'),
      click: () => runAction('close the tabs', () => browser.closeTabsForPerson(open().map((candidate) => candidate.id)))
    },
    {
      id: 'close-other-tabs',
      label: browser.text('native.context.closeOthers'),
      enabled: otherTabs.length > 0,
      click: () => runAction('close other tabs', () => browser.closeTabsForPerson(otherTabs.map((candidate) => candidate.id)))
    },
    {
      id: 'close-tabs-to-right',
      label: browser.text(verticalTabs ? 'native.context.closeBelow' : 'native.context.closeRight'),
      enabled: tabsToRight.length > 0,
      click: () => runAction('close tabs to the right', () => browser.closeTabsForPerson(tabsToRight.map((candidate) => candidate.id)))
    },
    { type: 'separator' },
    {
      id: 'reopen-closed-tab',
      label: browser.text('native.context.reopenClosed'),
      enabled: browser.closedTabs.length > 0,
      click: () => runAction('reopen a closed tab', () => browser.reopenClosedTab())
    },
    {
      id: 'bookmark-all-tabs',
      label: browser.text('native.context.bookmarkAllTabs'),
      enabled: workspaceTabs.some((candidate) => /^https?:/i.test(candidate.url)),
      click: () => runAction('bookmark all tabs', () => browser.window.webContents.send('browser:bookmark-all-tabs-requested', tab.mcpGroupId ?? null))
    }
  ])
  menu.popup({ window: browser.window, ...(onClosed ? { callback: onClosed } : {}) })
}
