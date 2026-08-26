import { ref, type Ref } from 'vue'
import type { BrowserTabState } from '../../../shared/types.js'

export interface HomeNavigationControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  websiteTabs: () => BrowserTabState[]
  settingsOpen: Ref<boolean>
  updateNoticeOpen: Ref<boolean>
  downloadsOpen: Ref<boolean>
  bookmarksOpen: Ref<boolean>
  historyOpen: Ref<boolean>
  tabSearchOpen: Ref<boolean>
  zoomOpen: Ref<boolean>
  runFindTransition: (operation: () => Promise<void>) => Promise<void>
  navigateHome: () => Promise<void>
}

export function useHomeNavigationController(options: HomeNavigationControllerOptions) {
  const lastWebsiteTabId = ref<string | null>(null)

  function rememberWebsiteTab(tab: BrowserTabState | undefined): void {
    if (tab && !tab.url.startsWith('hronaut://home')) lastWebsiteTabId.value = tab.id
  }

  function preferredWebsiteTab(): BrowserTabState | undefined {
    const tabs = options.websiteTabs()
    return tabs.find((tab) => tab.id === lastWebsiteTabId.value) ?? tabs.at(-1)
  }

  async function openHome(): Promise<void> {
    rememberWebsiteTab(options.activeTab.value)
    options.settingsOpen.value = false
    options.updateNoticeOpen.value = false
    options.downloadsOpen.value = false
    options.bookmarksOpen.value = false
    options.historyOpen.value = false
    options.tabSearchOpen.value = false
    options.zoomOpen.value = false
    await options.runFindTransition(options.navigateHome)
  }

  return {
    rememberWebsiteTab,
    preferredWebsiteTab,
    openHome
  }
}

export type HomeNavigationController = ReturnType<typeof useHomeNavigationController>
