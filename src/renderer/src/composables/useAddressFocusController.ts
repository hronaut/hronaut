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

  /** The overlays the person opens that focusing the address closes. */
  function overlays(): Ref<boolean>[] {
    return [options.settingsOpen, options.zoomOpen, options.tabSearchOpen]
  }

  async function focusClosing(openAtStart: readonly Ref<boolean>[], expectedActiveTabId?: string): Promise<boolean> {
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
    // The person opened an overlay while this waited: it keeps its place and the focus.
    if (overlays().some((overlay) => overlay.value && !openAtStart.includes(overlay))) return false

    for (const overlay of openAtStart) overlay.value = false
    // The update status shows itself again as an update downloads, so it closes whenever it is open.
    options.updateNoticeOpen.value = false
    let focused = false
    await options.runFindTransition(async () => {
      await nextTick()
      if (options.state.value.activeTabId !== focusTabId) return
      options.focusInput()
      focused = true
    })
    return focused
  }

  /**
   * Starts asking for the address now, for a caller that has to wait before it can focus. The focus it returns closes
   * only the overlays open at this point, and gives way to one the person opens meanwhile.
   */
  function begin(): (expectedActiveTabId?: string) => Promise<boolean> {
    const openAtStart = overlays().filter((overlay) => overlay.value)
    return (expectedActiveTabId) => focusClosing(openAtStart, expectedActiveTabId)
  }

  function focus(expectedActiveTabId?: string): Promise<boolean> {
    return begin()(expectedActiveTabId)
  }

  return { begin, focus }
}

export type AddressFocusController = ReturnType<typeof useAddressFocusController>
