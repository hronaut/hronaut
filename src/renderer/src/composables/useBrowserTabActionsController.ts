import { shallowRef, type Ref } from 'vue'
import type {
  BrowserState,
  BrowserTabState,
  HronautApi
} from '../../../shared/types.js'

type BrowserTabActionsApi = Pick<
  HronautApi,
  | 'closeTab'
  | 'navigate'
  | 'newTab'
  | 'reload'
  | 'reorderTab'
  | 'reorderTabs'
  | 'selectTab'
  | 'setAllTabsMuted'
  | 'setAllHumanInteractionLocked'
  | 'setTabHumanInteractionLocked'
  | 'setTabMuted'
  | 'setTabAgentPaused'
  | 'setTabPageLifecycle'
  | 'showWorkspaceContextMenu'
  | 'toggleDevTools'
  | 'showDevToolsConsole'
>

export interface BrowserTabActionsControllerOptions {
  state: Readonly<Ref<BrowserState>>
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  isHome: () => boolean
  browser: BrowserTabActionsApi
  syncState: (operation: Promise<BrowserState> | BrowserState) => Promise<void>
  beforeToggleDeveloperTools: () => void
  onSelectError: (error: unknown) => void
  onNavigateError: (error: unknown) => void
}

export function useBrowserTabActionsController(options: BrowserTabActionsControllerOptions) {
  const toggleOperations = new Map<string, Promise<void>>()
  const pendingToggleKeys = shallowRef<ReadonlySet<string>>(new Set())
  const navigationTokens = new Map<string, symbol>()
  let disposed = false

  function enqueueToggle(key: string, action: () => Promise<void>): Promise<void> {
    if (disposed) return Promise.resolve()
    const previous = toggleOperations.get(key) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(async () => {
      if (!disposed) await action()
    })
    toggleOperations.set(key, operation)
    pendingToggleKeys.value = new Set(toggleOperations.keys())
    return operation.finally(() => {
      if (toggleOperations.get(key) === operation) {
        toggleOperations.delete(key)
        pendingToggleKeys.value = new Set(toggleOperations.keys())
      }
    })
  }

  async function reorderTab(details: {
    tabId: string
    targetTabId: string
    placement: 'before' | 'after'
    /** Every tab the move takes along, when it moves several selected tabs. */
    tabIds?: readonly string[]
  }): Promise<void> {
    if (disposed) return
    await options.syncState(details.tabIds && details.tabIds.length > 1
      ? options.browser.reorderTabs(details.tabIds, details.targetTabId, details.placement)
      : options.browser.reorderTab(details.tabId, details.targetTabId, details.placement))
  }

  async function selectBrowserTab(tabId: string): Promise<boolean> {
    if (disposed) return false
    try {
      await options.syncState(options.browser.selectTab(tabId))
      return !disposed
    } catch (error) {
      if (!disposed) options.onSelectError(error)
      return false
    }
  }

  async function navigateAddress(address: string): Promise<void> {
    if (disposed) return
    const tabId = options.state.value.activeTabId ?? undefined
    const navigationKey = tabId ?? 'active-tab'
    const token = Symbol('navigation')
    navigationTokens.set(navigationKey, token)
    try {
      await options.syncState(options.browser.navigate({
        url: address,
        tabId
      }))
    } catch (error) {
      if (!disposed && navigationTokens.get(navigationKey) === token) options.onNavigateError(error)
    } finally {
      if (navigationTokens.get(navigationKey) === token) navigationTokens.delete(navigationKey)
    }
  }

  // Alt+Enter or ⌘+Return in the address field opens the address in a new tab of the shown tab's workspace, as Chrome
  // opens it in the same window.
  async function openAddressInNewTab(address: string, background: boolean): Promise<void> {
    if (disposed) return
    try {
      await options.syncState(options.browser.newTab({
        url: address,
        active: !background,
        focus: !background,
        mcpGroupId: options.activeTab.value?.mcpGroupId
      }))
    } catch (error) {
      if (!disposed) options.onNavigateError(error)
    }
  }

  async function retryActivePageProblem(): Promise<void> {
    if (disposed) return
    const tab = options.activeTab.value
    if (!tab?.pageProblem) return
    await options.syncState(options.browser.reload(tab.id))
  }

  async function showWorkspaceContextMenu(groupId: string): Promise<void> {
    if (disposed) return
    await options.browser.showWorkspaceContextMenu(groupId)
  }

  async function closeTab(tabId: string): Promise<void> {
    if (disposed) return
    await options.syncState(options.browser.closeTab(tabId))
  }

  async function toggleTabMuted(tab: BrowserTabState): Promise<void> {
    await enqueueToggle('audio', async () => {
      if (disposed) return
      const currentTab = options.state.value.tabs.find((candidate) => candidate.id === tab.id)
      if (!currentTab) return
      await options.syncState(options.browser.setTabMuted(tab.id, !currentTab.muted))
    })
  }

  async function toggleTabAgentPaused(tab: BrowserTabState): Promise<void> {
    await enqueueToggle(`agents:${tab.id}`, async () => {
      const current = options.state.value.tabs.find(candidate => candidate.id === tab.id)
      if (!current || options.state.value.agentControlLocked) return
      await options.syncState(options.browser.setTabAgentPaused(tab.id, !current.agentPaused))
    })
  }

  /**
   * Pauses or resumes agents on a tab, judged when its turn in the queue comes, so a quick second request cannot undo the first.
   * Resolves with whether this request left the tab in that state (false while agent control is locked), from main's own
   * answer: the shell's copy of the state can lag behind it when another change, such as a page's new title, arrives meanwhile.
   * With `takeOver`, the pause also records that you took the tab over, even when agents were already paused there.
   */
  async function setTabAgentPaused(tabId: string, paused: boolean, pauseOptions: { takeOver?: boolean } = {}): Promise<boolean> {
    let applied = false
    const takeOver = paused && pauseOptions.takeOver === true
    await enqueueToggle(`agents:${tabId}`, async () => {
      const current = options.state.value.tabs.find(candidate => candidate.id === tabId)
      if (!current || options.state.value.agentControlLocked) return
      if ((current.agentPaused === true) === paused && (!takeOver || current.takenOverAt !== undefined)) {
        applied = true
        return
      }
      const next = takeOver
        ? options.browser.setTabAgentPaused(tabId, paused, { takeOver: true })
        : options.browser.setTabAgentPaused(tabId, paused)
      await options.syncState(next)
      const answered = (await next).tabs.find(candidate => candidate.id === tabId)
      applied = answered !== undefined && (answered.agentPaused === true) === paused
    })
    return applied
  }

  async function togglePageLifecycle(tab: BrowserTabState): Promise<void> {
    await enqueueToggle(`lifecycle:${tab.id}`, async () => {
      const current = options.state.value.tabs.find(candidate => candidate.id === tab.id)
      if (!current) return
      await options.syncState(options.browser.setTabPageLifecycle(
        tab.id, current.pageLifecycleState === 'frozen' ? 'active' : 'frozen'
      ))
    })
  }

  async function toggleAllTabsMuted(): Promise<void> {
    await enqueueToggle('audio', async () => {
      if (disposed) return
      await options.syncState(options.browser.setAllTabsMuted(!options.state.value.allTabsMuted))
    })
  }

  async function toggleTabHumanInteraction(): Promise<void> {
    if (disposed) return
    const tab = options.activeTab.value
    if (!tab || options.isHome()) return
    await enqueueToggle('interaction', async () => {
      if (disposed) return
      const currentTab = options.state.value.tabs.find((candidate) => candidate.id === tab.id)
      if (!currentTab) return
      const locked = currentTab.humanInteractionInputLocked
        ?? (options.state.value.allHumanInteractionLocked || currentTab.humanInteractionLocked)
      await options.syncState(options.browser.setTabHumanInteractionLocked(tab.id, !locked))
    })
  }

  async function toggleAllHumanInteraction(): Promise<void> {
    await enqueueToggle('interaction', async () => {
      if (disposed) return
      await options.syncState(options.browser.setAllHumanInteractionLocked(!options.state.value.allHumanInteractionLocked))
    })
  }

  /** Runs a Developer Tools action for the tab in view, which Home and a locked tab have none of. */
  async function withDeveloperTools(action: (tabId: string) => Promise<boolean>): Promise<void> {
    if (disposed) return
    const tab = options.activeTab.value
    if (!tab || options.isHome()) return
    await enqueueToggle('interaction', async () => {
      const current = options.state.value.tabs.find(candidate => candidate.id === tab.id)
      if (!current) return
      const locked = current.humanInteractionInputLocked
        ?? (options.state.value.allHumanInteractionLocked || current.humanInteractionLocked)
      if (locked) return
      options.beforeToggleDeveloperTools()
      await action(tab.id)
    })
  }

  async function toggleDeveloperTools(): Promise<void> {
    await withDeveloperTools((tabId) => options.browser.toggleDevTools(tabId))
  }

  /** Developer Tools on the Console, as Chrome's Ctrl+Shift+J opens them; open ones turn to it. */
  async function showDeveloperToolsConsole(): Promise<void> {
    await withDeveloperTools((tabId) => options.browser.showDevToolsConsole(tabId))
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    navigationTokens.clear()
    toggleOperations.clear()
    pendingToggleKeys.value = new Set()
  }

  return {
    isTogglePending: (key: string) => pendingToggleKeys.value.has(key),
    reorderTab,
    selectBrowserTab,
    navigateAddress,
    openAddressInNewTab,
    retryActivePageProblem,
    showWorkspaceContextMenu,
    closeTab,
    toggleTabMuted,
    toggleTabAgentPaused,
    setTabAgentPaused,
    togglePageLifecycle,
    toggleAllTabsMuted,
    toggleTabHumanInteraction,
    toggleAllHumanInteraction,
    toggleDeveloperTools,
    showDeveloperToolsConsole,
    dispose
  }
}

export type BrowserTabActionsController = ReturnType<typeof useBrowserTabActionsController>
