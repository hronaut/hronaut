import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { McpHttpServer } from './mcp/server.js'
import { LocalizedError } from './localized-error.js'
import { tabAgentPauseOptions, type TakeOverOffers } from './take-over-offers.js'
import { validateTabOverviewPreviewIds, type BrowserState, type DroppedLinkTarget } from '../shared/types.js'

type TabsIpcTabs = Pick<BrowserTabsManager,
  | 'getState' | 'beforeStateReply' | 'getTabOverviewPreviews' | 'getTabOverviewPagePreview'
  | 'openHome' | 'newTab' | 'reopenClosedTab' | 'selectTabForPerson' | 'closeTabsForPerson'
  | 'openSplitViewAndWait' | 'updateSplitView' | 'closeSplitView'
  | 'setTabLabel' | 'setTabPinned' | 'setTabSleeping' | 'setTabPageLifecycle' | 'sleepInactiveTabs'
  | 'reorderTab' | 'reorderTabs' | 'openDroppedLink' | 'focusActivePage' | 'showTabContextMenu' | 'setTabMuted' | 'setAllTabsMuted'
  | 'setTabHumanInteractionLocked' | 'setAllHumanInteractionLocked'>

interface TabsIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Admits only the main window's shell document, not a detached panel window. */
  assertMainShellSender(event: IpcMainInvokeEvent): void
  /**
   * Registers a handler that is refused while saved workspaces are still initializing or failed to start;
   * the state and tab overview reads are admitted and wait in `runWorkspaceRead` instead.
   */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  /** Checks the sender, then reads once saved workspaces are initialized, dropping the read if its sender navigates away. */
  runWorkspaceRead<T>(event: IpcMainInvokeEvent, assertSender: (event: IpcMainInvokeEvent) => void, read: () => T): Promise<T>
  tabs(): TabsIpcTabs | null
  mcpServer(): Pick<McpHttpServer, 'setTabAgentPaused'> | null
  takeOvers(): Pick<TakeOverOffers, 'paused'>
}

/**
 * Replies to a shell action with the browser state it returned. The shell drops a reply if a state arrived meanwhile,
 * which a state it has not drawn yet always does, so a change waiting for that draw is sent first, before the reply.
 */
async function stateReply(host: { tabs(): Pick<BrowserTabsManager, 'beforeStateReply'> | null }, reply: Promise<BrowserState>): Promise<BrowserState> {
  const state = await reply
  host.tabs()?.beforeStateReply()
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

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerTabsIpc(host: TabsIpcHost): void {
  host.handleBrowserIpc('browser:get-state', async (event) => {
    return stateReply(host, host.runWorkspaceRead(event, host.assertTrustedSender, () => host.tabs()!.getState()))
  })
  host.handleBrowserIpc('browser:get-tab-overview-previews', async (event, value: unknown) => {
    host.assertTrustedSender(event)
    const tabIds = validateTabOverviewPreviewIds(value)
    return host.runWorkspaceRead(event, host.assertTrustedSender, () => host.tabs()!.getTabOverviewPreviews(tabIds))
  })
  host.handleBrowserIpc('browser:get-tab-overview-page-preview', async (event, value: unknown) => {
    host.assertTrustedSender(event)
    const [tabId] = validateTabOverviewPreviewIds([value])
    return host.runWorkspaceRead(event, host.assertTrustedSender, () => host.tabs()!.getTabOverviewPagePreview(tabId!))
  })
  host.handleBrowserIpc('browser:open-home', (event) => { host.assertTrustedSender(event); return stateReply(host, host.tabs()!.openHome()) })
  host.handleBrowserIpc('browser:new-tab', (event, options) => { host.assertTrustedSender(event); return stateReply(host, host.tabs()!.newTab(options)) })
  host.handleBrowserIpc('browser:reopen-closed-tab', (event, closedTabId: unknown) => {
    host.assertTrustedSender(event)
    if (closedTabId !== undefined && typeof closedTabId !== 'string') throw new TypeError('Invalid closed tab ID')
    return host.tabs()!.reopenClosedTab(closedTabId)
  })
  host.handleBrowserIpc('browser:select-tab', (event, tabId) => { host.assertTrustedSender(event); return stateReply(host, host.tabs()!.selectTabForPerson(tabId)) })
  host.handleBrowserIpc('browser:close-tab', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    return stateReply(host, host.tabs()!.closeTabsForPerson([tabId]))
  })
  host.handleBrowserIpc('browser:open-split-view', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid split-view tab ID')
    return host.tabs()!.openSplitViewAndWait(tabId)
  })
  host.handleBrowserIpc('browser:update-split-view', (event, updates: unknown) => {
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
    return host.tabs()!.updateSplitView({
      ...(candidate.orientation === 'vertical' || candidate.orientation === 'horizontal' ? { orientation: candidate.orientation } : {}),
      ...(typeof candidate.ratio === 'number' ? { ratio: candidate.ratio } : {}),
      ...(candidate.swap === true ? { swap: true } : {})
    })
  })
  host.handleBrowserIpc('browser:close-split-view', (event) => {
    host.assertTrustedSender(event)
    return host.tabs()!.closeSplitView()
  })
  host.handleBrowserIpc('browser:set-tab-label', (event, tabId: unknown, label: unknown) => {
    host.assertMainShellSender(event)
    if (typeof tabId !== 'string' || typeof label !== 'string') throw new TypeError('Invalid tab label')
    return host.tabs()!.setTabLabel(tabId, label)
  })
  host.handleBrowserIpc('browser:set-tab-pinned', (event, tabId: unknown, pinned: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof pinned !== 'boolean') throw new TypeError('Invalid pinned tab state')
    return host.tabs()!.setTabPinned(tabId, pinned)
  })
  host.handleBrowserIpc('browser:set-tab-sleeping', (event, tabId: unknown, sleeping: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof sleeping !== 'boolean') throw new TypeError('Invalid tab sleeping state')
    return host.tabs()!.setTabSleeping(tabId, sleeping)
  })
  host.handleBrowserIpc('browser:set-tab-agent-paused', (event, tabId: unknown, paused: unknown, options: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof paused !== 'boolean') throw new TypeError('Invalid tab agent pause state')
    const pauseOptions = tabAgentPauseOptions(options)
    if (!host.mcpServer()) throw new LocalizedError('appErrors.agentPause.serviceUnavailable')
    const state = host.mcpServer()!.setTabAgentPaused(tabId, paused, pauseOptions)
    if (paused) host.takeOvers().paused(tabId)
    return state
  })
  host.handleBrowserIpc('browser:set-tab-page-lifecycle', (event, tabId: unknown, state: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || (state !== 'active' && state !== 'frozen')) throw new TypeError('Invalid tab page lifecycle state')
    return host.tabs()!.setTabPageLifecycle(tabId, state)
  })
  host.handleBrowserIpc('browser:sleep-inactive-tabs', (event) => {
    host.assertTrustedSender(event)
    return host.tabs()!.sleepInactiveTabs()
  })
  host.handleBrowserIpc('browser:reorder-tab', (event, tabId: unknown, targetTabId: unknown, placement: unknown) => {
    host.assertTrustedSender(event)
    if (
      typeof tabId !== 'string'
      || typeof targetTabId !== 'string'
      || (placement !== 'before' && placement !== 'after')
    ) throw new TypeError('Invalid tab reorder request')
    return host.tabs()!.reorderTab(tabId, targetTabId, placement)
  })
  host.handleBrowserIpc('browser:reorder-tabs', (event, tabIds: unknown, targetTabId: unknown, placement: unknown) => {
    host.assertTrustedSender(event)
    if (typeof targetTabId !== 'string' || (placement !== 'before' && placement !== 'after')) throw new TypeError('Invalid tab reorder request')
    return host.tabs()!.reorderTabs(selectedTabIds(tabIds), targetTabId, placement)
  })
  host.handleBrowserIpc('browser:drop-link', (event, text: unknown, target: unknown) => {
    host.assertTrustedSender(event)
    if (typeof text !== 'string') throw new TypeError('Invalid dropped link')
    return stateReply(host, host.tabs()!.openDroppedLink(text, droppedLinkTarget(target)))
  })
  host.handleBrowserIpc('browser:focus-active-page', (event) => {
    host.assertTrustedSender(event)
    host.tabs()!.focusActivePage(event.sender)
  })
  host.handleBrowserIpc('browser:show-tab-context-menu', (event, tabId: unknown, selected: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    host.tabs()!.showTabContextMenu(tabId, undefined, selected === undefined ? undefined : selectedTabIds(selected))
  })
  host.handleBrowserIpc('browser:set-tab-muted', (event, tabId: unknown, muted: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof muted !== 'boolean') throw new TypeError('Invalid tab audio state')
    return host.tabs()!.setTabMuted(tabId, muted)
  })
  host.handleBrowserIpc('browser:set-all-tabs-muted', (event, muted: unknown) => {
    host.assertTrustedSender(event)
    if (typeof muted !== 'boolean') throw new TypeError('Invalid global tab audio state')
    return host.tabs()!.setAllTabsMuted(muted)
  })
  host.handleBrowserIpc('browser:set-tab-human-interaction-locked', (event, tabId: unknown, locked: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof locked !== 'boolean') throw new TypeError('Invalid tab interaction lock')
    return host.tabs()!.setTabHumanInteractionLocked(tabId, locked)
  })
  host.handleBrowserIpc('browser:set-all-human-interaction-locked', (event, locked: unknown) => {
    host.assertTrustedSender(event)
    if (typeof locked !== 'boolean') throw new TypeError('Invalid global interaction lock')
    return host.tabs()!.setAllHumanInteractionLocked(locked)
  })
}
