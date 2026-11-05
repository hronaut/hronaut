import { isHronautHomeUrl } from '../../../shared/home-url.js'
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
  zoomOpen: Ref<boolean>
  navigateHome: () => Promise<void>
  /** Main shows Home's Tabs view, with its search field taking the keyboard. */
  navigateHomeTabs: () => Promise<void>
}

export function useHomeNavigationController(options: HomeNavigationControllerOptions) {
  const lastWebsiteTabId = ref<string | null>(null)

  function rememberWebsiteTab(tab: BrowserTabState | undefined): void {
    if (tab && !isHronautHomeUrl(tab.url)) lastWebsiteTabId.value = tab.id
  }

  function preferredWebsiteTab(): BrowserTabState | undefined {
    const tabs = options.websiteTabs()
    return tabs.find((tab) => tab.id === lastWebsiteTabId.value) ?? tabs.at(-1)
  }

  /** What the shell shows over the page goes, so Home is in view. */
  function leaveForHome(): void {
    rememberWebsiteTab(options.activeTab.value)
    options.settingsOpen.value = false
    options.updateNoticeOpen.value = false
    options.downloadsOpen.value = false
    options.bookmarksOpen.value = false
    options.historyOpen.value = false
    options.zoomOpen.value = false
    // Find stays with the website's tab, as with any other tab shown, and comes back with it.
  }

  async function openHome(): Promise<void> {
    leaveForHome()
    await options.navigateHome()
  }

  /** Search tabs (Ctrl/Cmd+Shift+A): Home's Tabs view, with its search field focused. */
  async function openHomeTabs(): Promise<void> {
    leaveForHome()
    await options.navigateHomeTabs()
  }

  return {
    rememberWebsiteTab,
    preferredWebsiteTab,
    openHome,
    openHomeTabs
  }
}

export type HomeNavigationController = ReturnType<typeof useHomeNavigationController>
