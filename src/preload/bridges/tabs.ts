import { TABS_IPC } from '../../shared/ipc/tabs.js'
import type { HronautTabsApi } from '../../shared/types.js'
import { invoke, send, subscribe } from './ipc.js'

/** window.hronaut's tabs and their state, split view included. */
export const tabsApi: HronautTabsApi = {
  getState: () => invoke(TABS_IPC.getState),
  onStateChanged: (listener) => subscribe(TABS_IPC.stateChanged, (state) => listener(state)),
  stateDrawn: () => send(TABS_IPC.stateDrawn),
  onMcpTabActivity: (listener) => subscribe(TABS_IPC.mcpTabActivity, (activity) => listener(activity)),
  getTabOverviewPreviews: (tabIds) => invoke(TABS_IPC.getTabOverviewPreviews, tabIds),
  getTabOverviewPagePreview: (tabId) => invoke(TABS_IPC.getTabOverviewPagePreview, tabId),
  openHome: () => invoke(TABS_IPC.openHome),
  newTab: (options = {}) => invoke(TABS_IPC.newTab, options),
  reopenClosedTab: (closedTabId) => invoke(TABS_IPC.reopenClosedTab, closedTabId),
  selectTab: (tabId) => invoke(TABS_IPC.selectTab, tabId),
  closeTab: (tabId) => invoke(TABS_IPC.closeTab, tabId),
  closeTabs: (tabIds) => invoke(TABS_IPC.closeTabs, [...tabIds]),
  openSplitView: (tabId) => invoke(TABS_IPC.openSplitView, tabId),
  updateSplitView: (updates) => invoke(TABS_IPC.updateSplitView, updates),
  closeSplitView: () => invoke(TABS_IPC.closeSplitView),
  setTabLabel: (tabId, label) => invoke(TABS_IPC.setTabLabel, tabId, label),
  setTabPinned: (tabId, pinned) => invoke(TABS_IPC.setTabPinned, tabId, pinned),
  setTabSleeping: (tabId, sleeping) => invoke(TABS_IPC.setTabSleeping, tabId, sleeping),
  setTabAgentPaused: (tabId, paused, options) => invoke(TABS_IPC.setTabAgentPaused, tabId, paused, options),
  setTabPageLifecycle: (tabId, state) => invoke(TABS_IPC.setTabPageLifecycle, tabId, state),
  sleepInactiveTabs: () => invoke(TABS_IPC.sleepInactiveTabs),
  reorderTab: (tabId, targetTabId, placement) => invoke(TABS_IPC.reorderTab, tabId, targetTabId, placement),
  reorderTabs: (tabIds, targetTabId, placement) => invoke(TABS_IPC.reorderTabs, [...tabIds], targetTabId, placement),
  dropLink: (text, target) => invoke(TABS_IPC.dropLink, text, target),
  focusActivePage: () => invoke(TABS_IPC.focusActivePage),
  showTabContextMenu: (tabId, selectedTabIds) => invoke(TABS_IPC.showTabContextMenu, tabId, selectedTabIds && [...selectedTabIds]),
  setTabMuted: (tabId, muted) => invoke(TABS_IPC.setTabMuted, tabId, muted),
  setAllTabsMuted: (muted) => invoke(TABS_IPC.setAllTabsMuted, muted),
  setTabHumanInteractionLocked: (tabId, locked) => invoke(TABS_IPC.setTabHumanInteractionLocked, tabId, locked),
  setAllHumanInteractionLocked: (locked) => invoke(TABS_IPC.setAllHumanInteractionLocked, locked)
}
