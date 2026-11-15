import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserTabState } from '../../src/shared/types.js'
import { useHomeNavigationController } from '../../src/renderer/src/composables/useHomeNavigationController.js'

function tab(id: string, url = `https://${id}.example/`): BrowserTabState {
  return { id, url } as BrowserTabState
}

function harness() {
  const first = tab('first')
  const second = tab('second')
  const activeTab = ref<BrowserTabState | undefined>(first)
  const settingsOpen = ref(true)
  const updateNoticeOpen = ref(true)
  const downloadsOpen = ref(true)
  const bookmarksOpen = ref(true)
  const historyOpen = ref(true)
  const zoomOpen = ref(true)
  const navigateHome = vi.fn(async () => undefined)
  const navigateHomeTabs = vi.fn(async () => undefined)
  const controller = useHomeNavigationController({
    activeTab,
    websiteTabs: () => [first, second],
    settingsOpen,
    updateNoticeOpen,
    downloadsOpen,
    bookmarksOpen,
    historyOpen,
    zoomOpen,
    navigateHome,
    navigateHomeTabs
  })
  return {
    first,
    second,
    activeTab,
    surfaces: [
      settingsOpen,
      updateNoticeOpen,
      downloadsOpen,
      bookmarksOpen,
      historyOpen,
      zoomOpen
    ],
    navigateHome,
    navigateHomeTabs,
    controller
  }
}

describe('useHomeNavigationController', () => {
  it('remembers the latest website and falls back to the last available website tab', () => {
    const view = harness()

    expect(view.controller.preferredWebsiteTab()).toBe(view.second)
    view.controller.rememberWebsiteTab(view.first)
    expect(view.controller.preferredWebsiteTab()).toBe(view.first)
    view.controller.rememberWebsiteTab(tab('home', 'hronaut://home/'))
    expect(view.controller.preferredWebsiteTab()).toBe(view.first)
  })

  // Find stays with the website's tab, which the bar hides while Home is shown and brings back with the tab.
  it('closes competing surfaces and opens Home, leaving Find to the website\'s tab', async () => {
    const view = harness()

    await view.controller.openHome()

    expect(view.surfaces.every((surface) => surface.value === false)).toBe(true)
    expect(view.controller.preferredWebsiteTab()).toBe(view.first)
    expect(view.navigateHome).toHaveBeenCalledOnce()
    expect(view.navigateHomeTabs).not.toHaveBeenCalled()
  })

  // Search tabs is Home's Tabs view, a tab like Home itself: what covers the page closes for it as it does for Home.
  it('closes competing surfaces and opens Home\'s Tabs view for Search tabs', async () => {
    const view = harness()

    await view.controller.openHomeTabs()

    expect(view.surfaces.every((surface) => surface.value === false)).toBe(true)
    expect(view.controller.preferredWebsiteTab()).toBe(view.first)
    expect(view.navigateHomeTabs).toHaveBeenCalledOnce()
    expect(view.navigateHome).not.toHaveBeenCalled()
  })
})
