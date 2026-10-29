import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { BrowserState } from '../../../shared/types.js'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import { reactInspectionMenu } from '../react-inspection-menu.js'
import { isHronautHomeUrl } from '../url.js'
import type { TabContextMenuAccess, TabContextMenuTab } from './tab-context-menu-access.js'

/**
 * Shows a website tab's context menu: attention, new tab, reload, duplicate,
 * split view, React inspection, mute, pin, freeze, sleep, the workspace's own
 * menu, moving and closing tabs, reopening a closed one and bookmarking all
 * tabs. Hronaut Home has no tab menu. A failed action is logged and reported, never thrown.
 */
export function showTabContextMenu<Tab extends TabContextMenuTab>(access: TabContextMenuAccess<Tab>, tabId: string, onClosed?: () => void): void {
  const tab = access.getTab(tabId)
  if (isHronautHomeUrl(tab.url)) {
    onClosed?.()
    return
  }
  const websiteTabs = access.orderedTabs().filter((candidate) => !isHronautHomeUrl(candidate.url))
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
  const activeWebsiteTab = access.activeTabId() ? access.findTab(access.activeTabId()!) : undefined
  const reportError = (action: string) => (error: unknown): void => {
    console.error(`[browser] Could not ${action} from tab context menu:`, error)
    access.options().onActionFailed?.(action, error)
  }
  const runAction = (action: string, callback: () => unknown): void => {
    try {
      void Promise.resolve(callback()).catch(reportError(action))
    } catch (error) {
      reportError(action)(error)
    }
  }
  const siteMuted = access.isSiteMuted(tab)
  const currentGroup = tab.mcpGroupId ? access.mcpTabGroups().get(tab.mcpGroupId) : undefined
  const groupMenu: MenuItemConstructorOptions = currentGroup
    ? {
        id: 'workspace',
        label: access.text('native.context.workspace', { name: currentGroup.name }),
        submenu: access.workspaceContextMenuItems(currentGroup)
      }
    : {
        id: 'workspace',
        label: access.text('native.context.workspaceUnavailable'),
        enabled: false
      }
  const openSplitWith = async (firstTabId: string, secondTabId: string): Promise<BrowserState> => {
    const selected = await access.selectTabAndWait(firstTabId)
    if (selected.activeTabId !== firstTabId) return selected
    return access.openSplitViewAndWait(secondTabId)
  }
  const splitCandidates = websiteTabs.filter((candidate) => candidate.id !== tab.id)
  const splitMenu: MenuItemConstructorOptions = access.splitViewContains(tab.id)
    ? {
        id: 'split-view',
        label: access.text('native.context.splitView'),
        submenu: [
          {
            id: 'split-side-by-side',
            label: access.text('native.context.sideBySide'),
            type: 'radio',
            checked: access.splitView()?.orientation === 'vertical',
            click: () => runAction('change the split view layout', () => access.updateSplitView({ orientation: 'vertical' }))
          },
          {
            id: 'split-stacked',
            label: access.text('native.context.stacked'),
            type: 'radio',
            checked: access.splitView()?.orientation === 'horizontal',
            click: () => runAction('change the split view layout', () => access.updateSplitView({ orientation: 'horizontal' }))
          },
          { type: 'separator' },
          {
            id: 'swap-split-tabs',
            label: access.text('native.context.swapTabs'),
            click: () => runAction('swap the split view tabs', () => access.updateSplitView({ swap: true }))
          },
          {
            id: 'close-split-view',
            label: access.text('native.context.exitSplit'),
            click: () => runAction('close the split view', () => access.closeSplitView())
          }
        ]
      }
    : activeWebsiteTab && !isHronautHomeUrl(activeWebsiteTab.url) && activeWebsiteTab.id !== tab.id
      ? {
          id: 'open-in-split-view',
          label: access.text('native.context.openSplit'),
          click: () => runAction('open the tab in split view', () => openSplitWith(activeWebsiteTab.id, tab.id))
        }
      : {
          id: 'open-in-split-view',
          label: access.text('native.context.openBeside'),
          enabled: splitCandidates.length > 0,
          submenu: splitCandidates.map((candidate) => ({
            id: `split-with-${candidate.id}`,
            label: tabTitleForDisplay(candidate, access.text('tabSearch.newTabTitle')).slice(0, 72),
            click: () => runAction('open the tab in split view', () => openSplitWith(tab.id, candidate.id))
          }))
        }
  const shouldSleepTab = !tab.sleeping
  const verticalTabs = access.options().getTabPosition() === 'left'
  const attentionWorkspaceId = tab.mcpGroupId
  const attention = access.options().getTabAttention?.(tab.id, attentionWorkspaceId)
  const menu = Menu.buildFromTemplate([
    ...(attention ? [{
      id: 'resolve-attention',
      label: access.text('native.context.resolveAttention'),
      click: () => runAction('resolve the attention request', () => {
        if (access.findTab(tab.id) !== tab || tab.webContents.isDestroyed()
          || tab.mcpGroupId !== attentionWorkspaceId) return
        access.options().resolveTabAttention?.(attention.id, tab.id, attentionWorkspaceId)
      })
    }, { type: 'separator' as const }] : []),
    {
      id: 'new-tab',
      label: access.text('native.context.newTab'),
      // In the workspace of the tab whose menu this is, which the rail can show while another workspace's tab is
      // active. The window opens it as its + button does, so the cursor goes to the address field.
      click: () => runAction('open a new tab', () => access.window().webContents.send('browser:new-tab-requested', tab.mcpGroupId))
    },
    {
      id: 'reload-tab',
      label: access.text('native.context.reloadTab'),
      click: () => runAction('reload the tab', () => access.reload(tab.id))
    },
    {
      id: 'reload-tab-ignoring-cache',
      label: access.text('native.context.reloadNoCache'),
      click: () => runAction('reload the tab without cache', () => access.reloadIgnoringCache(tab.id))
    },
    {
      id: 'duplicate-tab',
      label: access.text('native.context.duplicateTab'),
      click: () => runAction('duplicate the tab', () => access.duplicateTab(tab.id))
    },
    splitMenu,
    reactInspectionMenu(access.reactInspectionController().status(tab.id), {
      title: access.text('reactInspection.title'), enable: access.text('reactInspection.enable'),
      disabled: access.text('reactInspection.disabled'), reloadRequired: access.text('reactInspection.reloadRequired'),
      installed: access.text('reactInspection.installed'), residue: access.text('reactInspection.residue')
    }, enabled => runAction('change React inspection', () => access.reactInspection(tab.id, { action: enabled ? 'enable' : 'disable' }, {
      epoch: 'human-tab-control',
      assertCurrent: () => { if (access.findTab(tab.id) !== tab || tab.webContents.isDestroyed()) throw new Error('The tab changed') }
    })), /^https?:/.test(tab.url) && !tab.sleeping),
    {
      id: tab.muted ? 'unmute-tab' : 'mute-tab',
      label: access.text(tab.muted ? 'native.context.unmuteTab' : 'native.context.muteTab'),
      click: () => runAction(tab.muted ? 'unmute the tab' : 'mute the tab', () => access.setTabMuted(tab.id, !tab.muted))
    },
    // Chrome's Mute Site, for every tab of the website in the tab's workspace and its later pages.
    ...(access.canMuteSite(tab) ? [{
      id: siteMuted ? 'unmute-site' : 'mute-site',
      label: access.text(siteMuted ? 'native.context.unmuteSite' : 'native.context.muteSite'),
      click: () => runAction(siteMuted ? 'unmute the site' : 'mute the site', () => access.setSiteMuted(tab.id, !siteMuted))
    }] : []),
    { type: 'separator' },
    {
      id: tab.pinned ? 'unpin-tab' : 'pin-tab',
      label: access.text(tab.pinned ? 'native.context.unpinTab' : 'native.context.pinTab'),
      click: () => runAction(tab.pinned ? 'unpin the tab' : 'pin the tab', () => access.setTabPinned(tab.id, !tab.pinned))
    },
    {
      id: tab.pageLifecycleState === 'frozen' ? 'resume-page' : 'freeze-page',
      label: access.text(tab.pageLifecycleState === 'frozen'
        ? 'native.context.resumePage'
        : tab.pageLifecycleState === 'unknown'
          ? 'native.context.pageLifecycleUnknown'
          : 'native.context.freezePage'),
      enabled: tab.pageLifecycleState !== 'unknown' && !tab.sleeping && !tab.loading,
      click: () => runAction(
        tab.pageLifecycleState === 'frozen' ? 'resume the page' : 'freeze the page',
        () => access.setTabPageLifecycle(tab.id, tab.pageLifecycleState === 'frozen' ? 'active' : 'frozen')
      )
    },
    {
      id: shouldSleepTab ? 'sleep-tab' : 'wake-tab',
      label: access.text(shouldSleepTab ? 'native.context.sleepTab' : 'native.context.wakeTab'),
      enabled: !shouldSleepTab || access.sleepBlockReason(
        tab,
        tab.id === access.activeTabId()
          && !access.splitViewContains(tab.id)
          && access.sleepFallbackTab(tab) !== undefined
      ) === undefined,
      click: () => runAction(
        shouldSleepTab ? 'put the tab to sleep' : 'wake the tab',
        () => access.setTabSleepingFromContextMenu(tab.id, shouldSleepTab)
      )
    },
    groupMenu,
    { type: 'separator' },
    {
      id: 'move-tab-left',
      label: access.text(verticalTabs ? 'native.context.moveUp' : 'native.context.moveLeft'),
      enabled: peerIndex > 0,
      click: () => runAction('move the tab left', () => access.reorderTab(tab.id, peers[peerIndex - 1]!.id, 'before'))
    },
    {
      id: 'move-tab-right',
      label: access.text(verticalTabs ? 'native.context.moveDown' : 'native.context.moveRight'),
      enabled: peerIndex >= 0 && peerIndex < peers.length - 1,
      click: () => runAction('move the tab right', () => access.reorderTab(tab.id, peers[peerIndex + 1]!.id, 'after'))
    },
    { type: 'separator' },
    {
      id: 'close-tab',
      label: access.text('native.context.closeTab'),
      click: () => runAction('close the tab', () => access.closeTabsForPerson([tab.id]))
    },
    {
      id: 'close-other-tabs',
      label: access.text('native.context.closeOthers'),
      enabled: otherTabs.length > 0,
      click: () => runAction('close other tabs', () => access.closeTabsForPerson(otherTabs.map((candidate) => candidate.id)))
    },
    {
      id: 'close-tabs-to-right',
      label: access.text(verticalTabs ? 'native.context.closeBelow' : 'native.context.closeRight'),
      enabled: tabsToRight.length > 0,
      click: () => runAction('close tabs to the right', () => access.closeTabsForPerson(tabsToRight.map((candidate) => candidate.id)))
    },
    {
      id: 'close-duplicate-tabs',
      label: access.text('native.context.closeDuplicates'),
      enabled: duplicateTabs.length > 0,
      click: () => runAction('close duplicate tabs', () => access.closeTabsForPerson(duplicateTabs.map((candidate) => candidate.id)))
    },
    { type: 'separator' },
    {
      id: 'reopen-closed-tab',
      label: access.text('native.context.reopenClosed'),
      enabled: access.closedTabs().length > 0,
      click: () => runAction('reopen a closed tab', () => access.reopenClosedTab())
    },
    {
      id: 'bookmark-all-tabs',
      label: access.text('native.context.bookmarkAllTabs'),
      // As in Chrome, the workspace's tabs go in a new bookmark collection, which the Bookmarks panel asks to name.
      enabled: workspaceTabs.some((candidate) => /^https?:/i.test(candidate.url)),
      click: () => runAction('bookmark all tabs', () => access.window().webContents.send('browser:bookmark-all-tabs-requested', tab.mcpGroupId ?? null))
    }
  ])
  menu.popup({ window: access.window(), ...(onClosed ? { callback: onClosed } : {}) })
}
