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
  const tabSearchOpen = ref(true)
  const zoomOpen = ref(true)
  const navigateHome = vi.fn(async () => undefined)
  const runFindTransition = vi.fn(async (operation: () => Promise<void>) => operation())
  const controller = useHomeNavigationController({
    activeTab,
    websiteTabs: () => [first, second],
    settingsOpen,
    updateNoticeOpen,
    downloadsOpen,
    bookmarksOpen,
    historyOpen,
    tabSearchOpen,
    zoomOpen,
    runFindTransition,
    navigateHome
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
      tabSearchOpen,
      zoomOpen
    ],
    navigateHome,
    runFindTransition,
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

  it('closes competing surfaces and opens Home through the Find transition', async () => {
    const view = harness()

    await view.controller.openHome()

    expect(view.surfaces.every((surface) => surface.value === false)).toBe(true)
    expect(view.controller.preferredWebsiteTab()).toBe(view.first)
    expect(view.runFindTransition).toHaveBeenCalledOnce()
    expect(view.navigateHome).toHaveBeenCalledOnce()
  })
})
