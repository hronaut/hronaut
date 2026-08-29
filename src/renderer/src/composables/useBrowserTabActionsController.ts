import type { Ref } from 'vue'
import type {
  BrowserState,
  BrowserTabState,
  HronautApi
} from '../../../shared/types.js'

type BrowserTabActionsApi = Pick<
  HronautApi,
  | 'closeTab'
  | 'navigate'
  | 'reload'
  | 'reorderTab'
  | 'selectTab'
  | 'setAllHumanInteractionLocked'
  | 'setTabHumanInteractionLocked'
  | 'setTabMuted'
  | 'showWorkspaceContextMenu'
  | 'toggleDevTools'
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
  const navigationGenerations = new Map<string, number>()

  function enqueueToggle(key: string, action: () => Promise<void>): Promise<void> {
    const previous = toggleOperations.get(key) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(action)
    toggleOperations.set(key, operation)
    return operation.finally(() => {
      if (toggleOperations.get(key) === operation) toggleOperations.delete(key)
    })
  }

  async function reorderTab(details: {
    tabId: string
    targetTabId: string
    placement: 'before' | 'after'
  }): Promise<void> {
    await options.syncState(options.browser.reorderTab(details.tabId, details.targetTabId, details.placement))
  }

  async function selectBrowserTab(tabId: string): Promise<boolean> {
    try {
      await options.syncState(options.browser.selectTab(tabId))
      return true
    } catch (error) {
      options.onSelectError(error)
      return false
    }
  }

  async function navigateAddress(address: string): Promise<void> {
    const tabId = options.state.value.activeTabId ?? undefined
    const navigationKey = tabId ?? 'active-tab'
    const generation = (navigationGenerations.get(navigationKey) ?? 0) + 1
    navigationGenerations.set(navigationKey, generation)
    try {
      await options.syncState(options.browser.navigate({
        url: address,
        tabId
      }))
    } catch (error) {
      if (navigationGenerations.get(navigationKey) === generation) options.onNavigateError(error)
    } finally {
      if (navigationGenerations.get(navigationKey) === generation) navigationGenerations.delete(navigationKey)
    }
  }

  async function retryActivePageProblem(): Promise<void> {
    const tab = options.activeTab.value
    if (!tab?.pageProblem) return
    await options.syncState(options.browser.reload(tab.id))
  }

  async function showWorkspaceContextMenu(groupId: string): Promise<void> {
    await options.browser.showWorkspaceContextMenu(groupId)
  }

  async function closeTab(tabId: string): Promise<void> {
    if (options.state.value.allHumanInteractionLocked) return
    await options.syncState(options.browser.closeTab(tabId))
  }

  async function toggleTabMuted(tab: BrowserTabState): Promise<void> {
    await enqueueToggle(`mute:${tab.id}`, async () => {
      const currentTab = options.state.value.tabs.find((candidate) => candidate.id === tab.id)
      if (!currentTab) return
      await options.syncState(options.browser.setTabMuted(tab.id, !currentTab.muted))
    })
  }

  async function toggleTabHumanInteraction(): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || options.isHome() || options.state.value.allHumanInteractionLocked) return
    await enqueueToggle(`interaction:${tab.id}`, async () => {
      const currentTab = options.state.value.tabs.find((candidate) => candidate.id === tab.id)
      if (!currentTab || options.state.value.allHumanInteractionLocked) return
      await options.syncState(options.browser.setTabHumanInteractionLocked(tab.id, !currentTab.humanInteractionLocked))
    })
  }

  async function toggleAllHumanInteraction(): Promise<void> {
    await enqueueToggle('interaction:all', async () => {
      await options.syncState(options.browser.setAllHumanInteractionLocked(!options.state.value.allHumanInteractionLocked))
    })
  }

  async function toggleDeveloperTools(): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || options.isHome() || options.state.value.allHumanInteractionLocked || tab.humanInteractionLocked) return
    options.beforeToggleDeveloperTools()
    await enqueueToggle(`devtools:${tab.id}`, async () => {
      await options.browser.toggleDevTools(tab.id)
    })
  }

  return {
    reorderTab,
    selectBrowserTab,
    navigateAddress,
    retryActivePageProblem,
    showWorkspaceContextMenu,
    closeTab,
    toggleTabMuted,
    toggleTabHumanInteraction,
    toggleAllHumanInteraction,
    toggleDeveloperTools
  }
}

export type BrowserTabActionsController = ReturnType<typeof useBrowserTabActionsController>
