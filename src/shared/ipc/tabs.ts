import type { BrowserSplitOrientation } from '../split-view.js'
import type {
  BrowserState,
  BrowserTabOverviewPreview,
  DroppedLinkTarget,
  McpTabActivity,
  NewTabOptions
} from '../types.js'
import type { EventChannel, InvokeChannel, SendChannel } from './channel.js'

/** The tabs and their state, split view included. Most changes answer with the state after them. */
export const TABS_IPC = {
  /** Shell → main: the tabs and workspaces as they are. */
  getState: 'browser:get-state' as InvokeChannel<[], BrowserState>,
  /** Main → shells: the state changed. Changes wait while the main window's shell has not reported the last state drawn, up to a timeout. */
  stateChanged: 'browser:state-changed' as EventChannel<[state: BrowserState]>,
  /** Shell → main: the shell drew the last state it was sent; only the main window's report paces the states main sends. */
  stateDrawn: 'browser:state-drawn' as SendChannel<[]>,
  /** Main → main window: what an agent is doing in a tab, for its activity in the tab strip. */
  mcpTabActivity: 'browser:mcp-tab-activity' as EventChannel<[activity: McpTabActivity]>,
  /** Shell → main: small pictures of these tabs' pages, for the tab overview. */
  getTabOverviewPreviews: 'browser:get-tab-overview-previews' as InvokeChannel<[tabIds: string[]], BrowserTabOverviewPreview[]>,
  /** Shell → main: a larger picture of the tab's page, for the tab overview. */
  getTabOverviewPagePreview: 'browser:get-tab-overview-page-preview' as InvokeChannel<[tabId: string], BrowserTabOverviewPreview>,
  /** Shell → main: opens Home. */
  openHome: 'browser:open-home' as InvokeChannel<[], BrowserState>,
  /** Shell → main: opens a new tab. */
  newTab: 'browser:new-tab' as InvokeChannel<[options: NewTabOptions], BrowserState>,
  /** Shell → main: reopens this closed tab, or the one closed last. */
  reopenClosedTab: 'browser:reopen-closed-tab' as InvokeChannel<[closedTabId?: string], BrowserState>,
  /** Shell → main: shows the tab. */
  selectTab: 'browser:select-tab' as InvokeChannel<[tabId: string], BrowserState>,
  /** Shell → main: closes the tab. */
  closeTab: 'browser:close-tab' as InvokeChannel<[tabId: string], BrowserState>,
  /** Shell → main: closes the tabs selected together in the tab strip. */
  closeTabs: 'browser:close-tabs' as InvokeChannel<[tabIds: string[]], BrowserState>,
  /** Shell → main: shows the tab beside the active one in a split view. */
  openSplitView: 'browser:open-split-view' as InvokeChannel<[tabId: string], BrowserState>,
  /** Shell → main: turns, resizes or swaps the split view. */
  updateSplitView: 'browser:update-split-view' as InvokeChannel<[updates: { orientation?: BrowserSplitOrientation; ratio?: number; swap?: boolean }], BrowserState>,
  /** Shell → main: ends the split view. */
  closeSplitView: 'browser:close-split-view' as InvokeChannel<[], BrowserState>,
  /** Main window → main: names the tab, answering whether the name was saved for sure. */
  setTabLabel: 'browser:set-tab-label' as InvokeChannel<[tabId: string, label: string], { state: BrowserState; status: 'saved' | 'durability-unconfirmed' }>,
  /** Shell → main: pins or unpins the tab. */
  setTabPinned: 'browser:set-tab-pinned' as InvokeChannel<[tabId: string, pinned: boolean], BrowserState>,
  /** Shell → main: puts the tab to sleep or wakes it. */
  setTabSleeping: 'browser:set-tab-sleeping' as InvokeChannel<[tabId: string, sleeping: boolean], BrowserState>,
  /** Shell → main: pauses or resumes the agents on the tab; with takeOver, the person took the tab over. */
  setTabAgentPaused: 'browser:set-tab-agent-paused' as InvokeChannel<[tabId: string, paused: boolean, options?: { takeOver?: boolean }], BrowserState>,
  /** Shell → main: freezes the tab's page or lets it run again. */
  setTabPageLifecycle: 'browser:set-tab-page-lifecycle' as InvokeChannel<[tabId: string, state: 'active' | 'frozen'], BrowserState>,
  /** Shell → main: puts every tab that may sleep to sleep now, while Memory Saver is on. */
  sleepInactiveTabs: 'browser:sleep-inactive-tabs' as InvokeChannel<[], BrowserState>,
  /** Shell → main: moves the tab before or after the target tab. */
  reorderTab: 'browser:reorder-tab' as InvokeChannel<[tabId: string, targetTabId: string, placement: 'before' | 'after'], BrowserState>,
  /** Shell → main: moves the tabs selected together, in their order, before or after the target tab. */
  reorderTabs: 'browser:reorder-tabs' as InvokeChannel<[tabIds: string[], targetTabId: string, placement: 'before' | 'after'], BrowserState>,
  /** Shell → main: opens a link or text dropped on the tab strip or rail where it was dropped. */
  dropLink: 'browser:drop-link' as InvokeChannel<[text: string, target: DroppedLinkTarget], BrowserState>,
  /** Shell → main: gives the keyboard to the page in view. */
  focusActivePage: 'browser:focus-active-page' as InvokeChannel<[], void>,
  /** Shell → main: shows the tab's menu, which acts on all the selected tabs when the tab is one of several selected ones. */
  showTabContextMenu: 'browser:show-tab-context-menu' as InvokeChannel<[tabId: string, selectedTabIds: string[] | undefined], void>,
  /** Shell → main: mutes or unmutes the tab. */
  setTabMuted: 'browser:set-tab-muted' as InvokeChannel<[tabId: string, muted: boolean], BrowserState>,
  /** Shell → main: mutes or unmutes every tab. */
  setAllTabsMuted: 'browser:set-all-tabs-muted' as InvokeChannel<[muted: boolean], BrowserState>,
  /** Shell → main: locks or unlocks the person's input on the tab's page. */
  setTabHumanInteractionLocked: 'browser:set-tab-human-interaction-locked' as InvokeChannel<[tabId: string, locked: boolean], BrowserState>,
  /** Shell → main: locks or unlocks the person's input on every tab's page. */
  setAllHumanInteractionLocked: 'browser:set-all-human-interaction-locked' as InvokeChannel<[locked: boolean], BrowserState>
} as const
