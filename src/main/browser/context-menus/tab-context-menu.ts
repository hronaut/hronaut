import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { BrowserState } from '../../../shared/types.js'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import { reactInspectionMenu } from '../react-inspection-menu.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { canMuteSite, isSiteMuted } from '../site-muting/site-muting.js'
import { setTabSleepingFromContextMenu, sleepBlockReason, sleepFallbackTab } from '../tab-sleep/tab-sleep.js'
import { workspaceContextMenuItems } from './workspace-context-menu.js'
import { findTab, getTab, orderedTabs } from '../browser-core.js'
import { reorderTab } from '../tab-arrangement/tab-arrangement.js'
import { selectedMenuTabs, showSelectedTabsContextMenu } from './selected-tabs-context-menu.js'

/**
 * Shows a website tab's context menu: attention, new tab, reload, duplicate,
 * split view, React inspection, mute, Mute Site, pin, freeze, sleep, the workspace's own
 * menu, moving and closing tabs, reopening a closed one and bookmarking all
 * tabs. Hronaut Home has no tab menu. On one of several selected tabs, the menu acts on them all. A failed action is
 * logged and reported, never thrown.
 */
export function showTabContextMenu(browser: Browser, tabId: string, onClosed?: () => void, selectedTabIds?: readonly string[]): void {
  const tab = getTab(browser, tabId)
  if (isHronautHomeUrl(tab.url)) {
    onClosed?.()
    return
  }
  const selected = selectedMenuTabs(browser, tab, selectedTabIds)
  if (selected.length) {
    showSelectedTabsContextMenu(browser, tab, selected, onClosed)
    return
  }
  const websiteTabs = orderedTabs(browser).filter((candidate) => !isHronautHomeUrl(candidate.url))
  const workspaceTabs = websiteTabs.filter((candidate) => candidate.mcpGroupId === tab.mcpGroupId)
  const workspaceIndex = workspaceTabs.indexOf(tab)
  const peers = workspaceTabs.filter((candidate) => candidate.pinned === tab.pinned)
  const peerIndex = peers.indexOf(tab)
  const otherTabs = workspaceTabs.filter((candidate) => !candidate.pinned && candidate.id !== tab.id)
  const tabsToRight = tab.pinned
    ? []
    : workspaceTabs.slice(workspaceIndex + 1).filter((candidate) => !candidate.pinned)
  const duplicateTabs = workspaceTabs.filter((candidate) => (
    !candidate.pinned && candidate.id !== tab.id && candidate.url === tab.url
  ))
  const activeWebsiteTab = browser.activeTabId ? findTab(browser, browser.activeTabId) : undefined
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
  const siteMuted = isSiteMuted(browser, tab)
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
  const openSplitWith = async (firstTabId: string, secondTabId: string): Promise<BrowserState> => {
    const selected = await browser.selectTabAndWait(firstTabId)
    if (selected.activeTabId !== firstTabId) return selected
    return browser.openSplitViewAndWait(secondTabId)
  }
  const splitCandidates = websiteTabs.filter((candidate) => candidate.id !== tab.id)
  const splitMenu: MenuItemConstructorOptions = browser.splitViewContains(tab.id)
    ? {
        id: 'split-view',
        label: browser.text('native.context.splitView'),
        submenu: [
          {
            id: 'split-side-by-side',
            label: browser.text('native.context.sideBySide'),
            type: 'radio',
            checked: browser.splitView?.orientation === 'vertical',
            click: () => runAction('change the split view layout', () => browser.updateSplitView({ orientation: 'vertical' }))
          },
          {
            id: 'split-stacked',
            label: browser.text('native.context.stacked'),
            type: 'radio',
            checked: browser.splitView?.orientation === 'horizontal',
            click: () => runAction('change the split view layout', () => browser.updateSplitView({ orientation: 'horizontal' }))
          },
          { type: 'separator' },
          {
            id: 'swap-split-tabs',
            label: browser.text('native.context.swapTabs'),
            click: () => runAction('swap the split view tabs', () => browser.updateSplitView({ swap: true }))
          },
          {
            id: 'close-split-view',
            label: browser.text('native.context.exitSplit'),
            click: () => runAction('close the split view', () => browser.closeSplitView())
          }
        ]
      }
    : activeWebsiteTab && !isHronautHomeUrl(activeWebsiteTab.url) && activeWebsiteTab.id !== tab.id
      ? {
          id: 'open-in-split-view',
          label: browser.text('native.context.openSplit'),
          click: () => runAction('open the tab in split view', () => openSplitWith(activeWebsiteTab.id, tab.id))
        }
      : {
          id: 'open-in-split-view',
          label: browser.text('native.context.openBeside'),
          enabled: splitCandidates.length > 0,
          submenu: splitCandidates.map((candidate) => ({
            id: `split-with-${candidate.id}`,
            label: tabTitleForDisplay(candidate, browser.text('tabSearch.newTabTitle')).slice(0, 72),
            click: () => runAction('open the tab in split view', () => openSplitWith(tab.id, candidate.id))
          }))
        }
  const shouldSleepTab = !tab.sleeping
  const verticalTabs = browser.options.getTabPosition() === 'left'
  const attentionWorkspaceId = tab.mcpGroupId
  const attention = browser.options.getTabAttention?.(tab.id, attentionWorkspaceId)
  const menu = Menu.buildFromTemplate([
    ...(attention ? [{
      id: 'resolve-attention',
      label: browser.text('native.context.resolveAttention'),
      click: () => runAction('resolve the attention request', () => {
        if (findTab(browser, tab.id) !== tab || tab.webContents.isDestroyed()
          || tab.mcpGroupId !== attentionWorkspaceId) return
        browser.options.resolveTabAttention?.(attention.id, tab.id, attentionWorkspaceId)
      })
    }, { type: 'separator' as const }] : []),
    {
      id: 'new-tab',
      label: browser.text('native.context.newTab'),
      // In the workspace of the tab whose menu this is, which the rail can show while another workspace's tab is
      // active. The window opens it as its + button does, so the cursor goes to the address field.
      click: () => runAction('open a new tab', () => browser.window.webContents.send('browser:new-tab-requested', tab.mcpGroupId))
    },
    {
      id: 'reload-tab',
      label: browser.text('native.context.reloadTab'),
      click: () => runAction('reload the tab', () => browser.reload(tab.id))
    },
    {
      id: 'reload-tab-ignoring-cache',
      label: browser.text('native.context.reloadNoCache'),
      click: () => runAction('reload the tab without cache', () => browser.reloadIgnoringCache(tab.id))
    },
    {
      id: 'duplicate-tab',
      label: browser.text('native.context.duplicateTab'),
      click: () => runAction('duplicate the tab', () => browser.duplicateTab(tab.id))
    },
    splitMenu,
    reactInspectionMenu(browser.reactInspectionController.status(tab.id), {
      title: browser.text('reactInspection.title'), enable: browser.text('reactInspection.enable'),
      disabled: browser.text('reactInspection.disabled'), reloadRequired: browser.text('reactInspection.reloadRequired'),
      installed: browser.text('reactInspection.installed'), residue: browser.text('reactInspection.residue')
    }, enabled => runAction('change React inspection', () => browser.reactInspection(tab.id, { action: enabled ? 'enable' : 'disable' }, {
      epoch: 'human-tab-control',
      assertCurrent: () => { if (findTab(browser, tab.id) !== tab || tab.webContents.isDestroyed()) throw new Error('The tab changed') }
    })), /^https?:/.test(tab.url) && !tab.sleeping),
    {
      id: tab.muted ? 'unmute-tab' : 'mute-tab',
      label: browser.text(tab.muted ? 'native.context.unmuteTab' : 'native.context.muteTab'),
      click: () => runAction(tab.muted ? 'unmute the tab' : 'mute the tab', () => browser.setTabMuted(tab.id, !tab.muted))
    },
    // Chrome's Mute Site, for every tab of the website in the tab's workspace and its later pages.
    ...(canMuteSite(browser, tab) ? [{
      id: siteMuted ? 'unmute-site' : 'mute-site',
      label: browser.text(siteMuted ? 'native.context.unmuteSite' : 'native.context.muteSite'),
      click: () => runAction(siteMuted ? 'unmute the site' : 'mute the site', () => browser.setSiteMuted(tab.id, !siteMuted))
    }] : []),
    { type: 'separator' },
    {
      id: tab.pinned ? 'unpin-tab' : 'pin-tab',
      label: browser.text(tab.pinned ? 'native.context.unpinTab' : 'native.context.pinTab'),
      click: () => runAction(tab.pinned ? 'unpin the tab' : 'pin the tab', () => browser.setTabPinned(tab.id, !tab.pinned))
    },
    {
      id: tab.pageLifecycleState === 'frozen' ? 'resume-page' : 'freeze-page',
      label: browser.text(tab.pageLifecycleState === 'frozen'
        ? 'native.context.resumePage'
        : tab.pageLifecycleState === 'unknown'
          ? 'native.context.pageLifecycleUnknown'
          : 'native.context.freezePage'),
      enabled: tab.pageLifecycleState !== 'unknown' && !tab.sleeping && !tab.loading,
      click: () => runAction(
        tab.pageLifecycleState === 'frozen' ? 'resume the page' : 'freeze the page',
        () => browser.setTabPageLifecycle(tab.id, tab.pageLifecycleState === 'frozen' ? 'active' : 'frozen')
      )
    },
    {
      id: shouldSleepTab ? 'sleep-tab' : 'wake-tab',
      label: browser.text(shouldSleepTab ? 'native.context.sleepTab' : 'native.context.wakeTab'),
      enabled: !shouldSleepTab || sleepBlockReason(
        browser,
        tab,
        tab.id === browser.activeTabId
          && !browser.splitViewContains(tab.id)
          && sleepFallbackTab(browser, tab) !== undefined
      ) === undefined,
      click: () => runAction(
        shouldSleepTab ? 'put the tab to sleep' : 'wake the tab',
        () => setTabSleepingFromContextMenu(browser, tab.id, shouldSleepTab)
      )
    },
    groupMenu,
    { type: 'separator' },
    {
      id: 'move-tab-left',
      label: browser.text(verticalTabs ? 'native.context.moveUp' : 'native.context.moveLeft'),
      enabled: peerIndex > 0,
      click: () => runAction('move the tab left', () => reorderTab(browser, tab.id, peers[peerIndex - 1]!.id, 'before'))
    },
    {
      id: 'move-tab-right',
      label: browser.text(verticalTabs ? 'native.context.moveDown' : 'native.context.moveRight'),
      enabled: peerIndex >= 0 && peerIndex < peers.length - 1,
      click: () => runAction('move the tab right', () => reorderTab(browser, tab.id, peers[peerIndex + 1]!.id, 'after'))
    },
    { type: 'separator' },
    {
      id: 'close-tab',
      label: browser.text('native.context.closeTab'),
      click: () => runAction('close the tab', () => browser.closeTabsForPerson([tab.id]))
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
    {
      id: 'close-duplicate-tabs',
      label: browser.text('native.context.closeDuplicates'),
      enabled: duplicateTabs.length > 0,
      click: () => runAction('close duplicate tabs', () => browser.closeTabsForPerson(duplicateTabs.map((candidate) => candidate.id)))
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
      // As in Chrome, the workspace's tabs go in a new bookmark collection, which the Bookmarks panel asks to name.
      enabled: workspaceTabs.some((candidate) => /^https?:/i.test(candidate.url)),
      click: () => runAction('bookmark all tabs', () => browser.window.webContents.send('browser:bookmark-all-tabs-requested', tab.mcpGroupId ?? null))
    }
  ])
  menu.popup({ window: browser.window, ...(onClosed ? { callback: onClosed } : {}) })
}
