import { nextTick, type Ref } from 'vue'
import type { BrowserState, BrowserTabState, HronautApi } from '../../../shared/types.js'

type AddressFocusBrowserApi = Pick<HronautApi, 'newTab'>

export interface AddressFocusControllerOptions {
  state: Readonly<Ref<BrowserState>>
  isHome: () => boolean
  preferredWebTab: () => BrowserTabState | undefined
  selectBrowserTab: (tabId: string) => Promise<boolean>
  browser: AddressFocusBrowserApi
  syncState: (operation: Promise<BrowserState> | BrowserState) => Promise<void>
  settingsOpen: Ref<boolean>
  updateNoticeOpen: Ref<boolean>
  zoomOpen: Ref<boolean>
  tabSearchOpen: Ref<boolean>
  runFindTransition: (action: () => void | Promise<void>) => Promise<void>
  focusInput: () => void
}

export function useAddressFocusController(options: AddressFocusControllerOptions) {
  async function createFallbackTab(): Promise<string | null> {
    const operation = options.browser.newTab()
    const [createdState] = await Promise.all([
      operation,
      options.syncState(operation)
    ])
    const createdTabId = createdState.activeTabId
    return createdTabId && options.state.value.activeTabId === createdTabId
      ? createdTabId
      : null
  }

  async function focus(expectedActiveTabId?: string): Promise<boolean> {
    if (expectedActiveTabId && options.state.value.activeTabId !== expectedActiveTabId) return false

    const startingActiveTabId = options.state.value.activeTabId
    let focusTabId = expectedActiveTabId ?? options.state.value.activeTabId
    if (options.isHome()) {
      const tab = options.preferredWebTab()
      if (tab) {
        const selected = await options.selectBrowserTab(tab.id)
        if (selected) {
          if (options.state.value.activeTabId !== tab.id) return false
          focusTabId = tab.id
        } else {
          if (options.state.value.activeTabId !== startingActiveTabId) return false
          focusTabId = await createFallbackTab()
        }
      } else focusTabId = await createFallbackTab()
    }
    if (!focusTabId || options.state.value.activeTabId !== focusTabId) return false

    options.settingsOpen.value = false
    options.updateNoticeOpen.value = false
    options.zoomOpen.value = false
    options.tabSearchOpen.value = false
    let focused = false
    await options.runFindTransition(async () => {
      await nextTick()
      if (options.state.value.activeTabId !== focusTabId) return
      options.focusInput()
      focused = true
    })
    return focused
  }

  return { focus }
}

export type AddressFocusController = ReturnType<typeof useAddressFocusController>
