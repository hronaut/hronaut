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
>

export interface BrowserTabActionsControllerOptions {
  state: Readonly<Ref<BrowserState>>
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  isHome: () => boolean
  browser: BrowserTabActionsApi
  syncState: (operation: Promise<BrowserState> | BrowserState) => Promise<void>
  onSelectError: (error: unknown) => void
  onNavigateError: (error: unknown) => void
}

export function useBrowserTabActionsController(options: BrowserTabActionsControllerOptions) {
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
    try {
      await options.syncState(options.browser.navigate({
        url: address,
        tabId: options.state.value.activeTabId ?? undefined
      }))
    } catch (error) {
      options.onNavigateError(error)
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
    await options.syncState(options.browser.setTabMuted(tab.id, !tab.muted))
  }

  async function toggleTabHumanInteraction(): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || options.isHome() || options.state.value.allHumanInteractionLocked) return
    await options.syncState(options.browser.setTabHumanInteractionLocked(tab.id, !tab.humanInteractionLocked))
  }

  async function toggleAllHumanInteraction(): Promise<void> {
    await options.syncState(options.browser.setAllHumanInteractionLocked(!options.state.value.allHumanInteractionLocked))
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
    toggleAllHumanInteraction
  }
}

export type BrowserTabActionsController = ReturnType<typeof useBrowserTabActionsController>
