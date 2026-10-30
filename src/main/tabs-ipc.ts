import type { IpcMainInvokeEvent } from 'electron'
import type { TypedIpcMain } from './typed-ipc.js'
import type { Browser } from './browser/browser.js'
import type { McpHttpServer } from './mcp/server.js'
import { LocalizedError } from './localized-error.js'
import { tabAgentPauseOptions, type TakeOverOffers } from './agents/take-over-offers.js'
import { validateTabOverviewPreviewIds, type BrowserState, type DroppedLinkTarget, type NewTabOptions } from '../shared/types.js'
import { showTabContextMenu } from './browser/context-menus/tab-context-menu.js'
import { openDroppedLink } from './browser/dropped-links/dropped-links.js'
import { setAllHumanInteractionLocked, setTabHumanInteractionLocked } from './browser/interaction-lock/interaction-lock.js'
import { reorderTab, reorderTabs, setTabPinned } from './browser/tab-arrangement/tab-arrangement.js'
import { setAllTabsMuted, setTabMuted } from './browser/tab-muting/tab-muting.js'
import { getTabOverviewPagePreview, getTabOverviewPreviews } from './browser/tab-overview-previews/tab-overview-previews.js'
import { sleepInactiveTabs } from './browser/tab-sleep/memory-saver.js'
import { setTabSleeping } from './browser/tab-sleep/tab-sleep.js'
import { setTabPageLifecycle } from './browser/page-lifecycle/page-lifecycle.js'
import { openSplitViewAndWait, updateSplitView, closeSplitView } from './browser/split-view/split-view.js'
import { browserState } from './browser/browser-state/browser-state.js'
import { closeTabsForPerson } from './browser/tab-close/close-tabs-for-person.js'
import { saveTabLabel } from './browser/tab-labels/tab-labels.js'
import { openHome } from './browser/home-tabs/home-tabs.js'
import { newTab } from './browser/new-tabs/open-new-tab.js'
import { reopenClosedTab } from './browser/tab-reopening/tab-reopening.js'
import { selectTabForPerson } from './browser/tab-selection/person-tab-switch.js'
import { focusActivePage } from './browser/trusted-chrome-focus/trusted-chrome-focus.js'
import { TABS_IPC } from '../shared/ipc/tabs.js'

interface TabsIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Admits only the main window's shell document, not a detached panel window. */
  assertMainShellSender(event: IpcMainInvokeEvent): void
  /**
   * Registers a handler that is refused while saved workspaces are still initializing or failed to start;
   * the state and tab overview reads are admitted and wait in `runWorkspaceRead` instead.
   */
  handleBrowserIpc: TypedIpcMain['handle']
  /** Checks the sender, then reads once saved workspaces are initialized, dropping the read if its sender navigates away. */
  runWorkspaceRead<T>(event: IpcMainInvokeEvent, assertSender: (event: IpcMainInvokeEvent) => void, read: () => T): Promise<T>
  tabs(): Browser | null
  mcpServer(): Pick<McpHttpServer, 'setTabAgentPaused'> | null
  takeOvers(): Pick<TakeOverOffers, 'paused'>
}

/**
 * Replies to a shell action with the browser state it returned. The shell drops a reply if a state arrived meanwhile,
 * which a state it has not drawn yet always does, so a change waiting for that draw is sent first, before the reply.
 */
async function stateReply(host: { tabs(): Browser | null }, reply: Promise<BrowserState>): Promise<BrowserState> {
  const state = await reply
  host.tabs()?.statePublication.beforeReply()
  return state
}

/** Where the shell says a link was dropped: on a tab, before or after one, or on a workspace's New tab button. */
function droppedLinkTarget(value: unknown): DroppedLinkTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid dropped link target')
  const { tabId, placement, workspaceId } = value as Record<string, unknown>
  if (tabId !== undefined) {
    if (typeof tabId !== 'string' || (placement !== 'onto' && placement !== 'before' && placement !== 'after') || workspaceId !== undefined) {
      throw new TypeError('Invalid dropped link target')
    }
    return { tabId, placement }
  }
  if (placement !== undefined || (workspaceId !== undefined && typeof workspaceId !== 'string')) throw new TypeError('Invalid dropped link target')
  return workspaceId === undefined ? {} : { workspaceId }
}

/** The most tabs one request can name: far more than a person selects, and few enough to check at once. */
const MAX_SELECTED_TABS = 10_000

/** The ids of the tabs selected in the strip or rail, as a request names them. */
function selectedTabIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SELECTED_TABS || value.some((tabId) => typeof tabId !== 'string')) {
    throw new TypeError('Invalid selected tabs')
  }
  return [...value as string[]]
}

/** The shell's options for a new tab, each of the type newTab reads; newTab checks the address, workspace and font size itself. */
function newTabOptions(value: unknown): NewTabOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid new tab options')
  const { url, active, mcpGroupId, focus, zoomIsolated, defaultFontSize, loadsInTurn } = value as Record<string, unknown>
  if (
    (url !== undefined && typeof url !== 'string')
    || (mcpGroupId !== undefined && typeof mcpGroupId !== 'string')
    || (defaultFontSize !== undefined && typeof defaultFontSize !== 'number')
    || (active !== undefined && typeof active !== 'boolean')
    || (focus !== undefined && typeof focus !== 'boolean')
    || (zoomIsolated !== undefined && typeof zoomIsolated !== 'boolean')
    || (loadsInTurn !== undefined && typeof loadsInTurn !== 'boolean')
  ) {
    throw new TypeError('Invalid new tab options')
  }
  return value as NewTabOptions
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerTabsIpc(host: TabsIpcHost): void {
  host.handleBrowserIpc(TABS_IPC.getState, async (event) => {
    return stateReply(host, host.runWorkspaceRead(event, host.assertTrustedSender, () => browserState(host.tabs()!)))
  })
  host.handleBrowserIpc(TABS_IPC.getTabOverviewPreviews, async (event, value: unknown) => {
    host.assertTrustedSender(event)
    const tabIds = validateTabOverviewPreviewIds(value)
    return host.runWorkspaceRead(event, host.assertTrustedSender, () => getTabOverviewPreviews(host.tabs()!, tabIds))
  })
  host.handleBrowserIpc(TABS_IPC.getTabOverviewPagePreview, async (event, value: unknown) => {
    host.assertTrustedSender(event)
    const [tabId] = validateTabOverviewPreviewIds([value])
    return host.runWorkspaceRead(event, host.assertTrustedSender, () => getTabOverviewPagePreview(host.tabs()!, tabId!))
  })
  host.handleBrowserIpc(TABS_IPC.openHome, (event) => { host.assertTrustedSender(event); return stateReply(host, openHome(host.tabs()!)) })
  host.handleBrowserIpc(TABS_IPC.newTab, (event, options) => { host.assertTrustedSender(event); return stateReply(host, newTab(host.tabs()!, newTabOptions(options))) })
  host.handleBrowserIpc(TABS_IPC.reopenClosedTab, (event, closedTabId: unknown) => {
    host.assertTrustedSender(event)
    if (closedTabId !== undefined && typeof closedTabId !== 'string') throw new TypeError('Invalid closed tab ID')
    return reopenClosedTab(host.tabs()!, closedTabId)
  })
  host.handleBrowserIpc(TABS_IPC.selectTab, (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    return stateReply(host, selectTabForPerson(host.tabs()!, tabId))
  })
  host.handleBrowserIpc(TABS_IPC.closeTab, (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    return stateReply(host, closeTabsForPerson(host.tabs()!, [tabId]))
  })
  host.handleBrowserIpc(TABS_IPC.closeTabs, (event, tabIds: unknown) => {
    host.assertTrustedSender(event)
    return stateReply(host, closeTabsForPerson(host.tabs()!, selectedTabIds(tabIds)))
  })
  host.handleBrowserIpc(TABS_IPC.openSplitView, (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid split-view tab ID')
    return openSplitViewAndWait(host.tabs()!, tabId)
  })
  host.handleBrowserIpc(TABS_IPC.updateSplitView, (event, updates: unknown) => {
    host.assertTrustedSender(event)
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new TypeError('Invalid split-view update')
    const candidate = updates as Record<string, unknown>
    if (candidate.orientation !== undefined && candidate.orientation !== 'vertical' && candidate.orientation !== 'horizontal') {
      throw new TypeError('Invalid split-view orientation')
    }
    if (candidate.ratio !== undefined && (typeof candidate.ratio !== 'number' || !Number.isFinite(candidate.ratio))) {
      throw new TypeError('Invalid split-view ratio')
    }
    if (candidate.swap !== undefined && typeof candidate.swap !== 'boolean') throw new TypeError('Invalid split-view swap flag')
    return updateSplitView(host.tabs()!, {
      ...(candidate.orientation === 'vertical' || candidate.orientation === 'horizontal' ? { orientation: candidate.orientation } : {}),
      ...(typeof candidate.ratio === 'number' ? { ratio: candidate.ratio } : {}),
      ...(candidate.swap === true ? { swap: true } : {})
    })
  })
  host.handleBrowserIpc(TABS_IPC.closeSplitView, (event) => {
    host.assertTrustedSender(event)
    return closeSplitView(host.tabs()!)
  })
  host.handleBrowserIpc(TABS_IPC.setTabLabel, (event, tabId: unknown, label: unknown) => {
    host.assertMainShellSender(event)
    if (typeof tabId !== 'string' || typeof label !== 'string') throw new TypeError('Invalid tab label')
    return saveTabLabel(host.tabs()!, tabId, label)
  })
  host.handleBrowserIpc(TABS_IPC.setTabPinned, (event, tabId: unknown, pinned: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof pinned !== 'boolean') throw new TypeError('Invalid pinned tab state')
    return setTabPinned(host.tabs()!, tabId, pinned)
  })
  host.handleBrowserIpc(TABS_IPC.setTabSleeping, (event, tabId: unknown, sleeping: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof sleeping !== 'boolean') throw new TypeError('Invalid tab sleeping state')
    return setTabSleeping(host.tabs()!, tabId, sleeping)
  })
  host.handleBrowserIpc(TABS_IPC.setTabAgentPaused, (event, tabId: unknown, paused: unknown, options: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof paused !== 'boolean') throw new TypeError('Invalid tab agent pause state')
    const pauseOptions = tabAgentPauseOptions(options)
    if (!host.mcpServer()) throw new LocalizedError('appErrors.agentPause.serviceUnavailable')
    const state = host.mcpServer()!.setTabAgentPaused(tabId, paused, pauseOptions)
    if (paused) host.takeOvers().paused(tabId)
    return state
  })
  host.handleBrowserIpc(TABS_IPC.setTabPageLifecycle, (event, tabId: unknown, state: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || (state !== 'active' && state !== 'frozen')) throw new TypeError('Invalid tab page lifecycle state')
    return setTabPageLifecycle(host.tabs()!, tabId, state)
  })
  host.handleBrowserIpc(TABS_IPC.sleepInactiveTabs, (event) => {
    host.assertTrustedSender(event)
    return sleepInactiveTabs(host.tabs()!)
  })
  host.handleBrowserIpc(TABS_IPC.reorderTab, (event, tabId: unknown, targetTabId: unknown, placement: unknown) => {
    host.assertTrustedSender(event)
    if (
      typeof tabId !== 'string'
      || typeof targetTabId !== 'string'
      || (placement !== 'before' && placement !== 'after')
    ) throw new TypeError('Invalid tab reorder request')
    return reorderTab(host.tabs()!, tabId, targetTabId, placement)
  })
  host.handleBrowserIpc(TABS_IPC.reorderTabs, (event, tabIds: unknown, targetTabId: unknown, placement: unknown) => {
    host.assertTrustedSender(event)
    if (typeof targetTabId !== 'string' || (placement !== 'before' && placement !== 'after')) throw new TypeError('Invalid tab reorder request')
    return reorderTabs(host.tabs()!, selectedTabIds(tabIds), targetTabId, placement)
  })
  host.handleBrowserIpc(TABS_IPC.dropLink, (event, text: unknown, target: unknown) => {
    host.assertTrustedSender(event)
    if (typeof text !== 'string') throw new TypeError('Invalid dropped link')
    return stateReply(host, openDroppedLink(host.tabs()!, text, droppedLinkTarget(target)))
  })
  host.handleBrowserIpc(TABS_IPC.focusActivePage, (event) => {
    host.assertTrustedSender(event)
    focusActivePage(host.tabs()!, event.sender)
  })
  host.handleBrowserIpc(TABS_IPC.showTabContextMenu, (event, tabId: unknown, selected: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    showTabContextMenu(host.tabs()!, tabId, undefined, selected === undefined ? undefined : selectedTabIds(selected))
  })
  host.handleBrowserIpc(TABS_IPC.setTabMuted, (event, tabId: unknown, muted: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof muted !== 'boolean') throw new TypeError('Invalid tab audio state')
    return setTabMuted(host.tabs()!, tabId, muted)
  })
  host.handleBrowserIpc(TABS_IPC.setAllTabsMuted, (event, muted: unknown) => {
    host.assertTrustedSender(event)
    if (typeof muted !== 'boolean') throw new TypeError('Invalid global tab audio state')
    return setAllTabsMuted(host.tabs()!, muted)
  })
  host.handleBrowserIpc(TABS_IPC.setTabHumanInteractionLocked, (event, tabId: unknown, locked: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof locked !== 'boolean') throw new TypeError('Invalid tab interaction lock')
    return setTabHumanInteractionLocked(host.tabs()!, tabId, locked)
  })
  host.handleBrowserIpc(TABS_IPC.setAllHumanInteractionLocked, (event, locked: unknown) => {
    host.assertTrustedSender(event)
    if (typeof locked !== 'boolean') throw new TypeError('Invalid global interaction lock')
    return setAllHumanInteractionLocked(host.tabs()!, locked)
  })
}
