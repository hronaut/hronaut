import { nextTick, watch, type Ref } from 'vue'
import type { BrowserState, BrowserTabState, HronautApi } from '../../../../shared/types.js'

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
  /**
   * Find and the panels and dialogs that focusing the address does not close itself but would take the keyboard focus
   * from. One the person opens while the focus waits keeps its place and the focus.
   */
  otherSurfacesOpen: readonly Readonly<Ref<boolean>>[]
  /**
   * What a tab brings back when it is shown, such as its Find. Shown once the tab this chooses from Home is shown, it
   * came with the tab, which the person did not open.
   */
  surfacesShownWithTab?: readonly Readonly<Ref<boolean>>[]
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

  function openSurfaces(): Readonly<Ref<boolean>>[] {
    return [...overlays(), ...options.otherSurfacesOpen].filter((surface) => surface.value)
  }

  /** Selects the tab, and reports the surfaces that came with it, shown once it was shown. */
  async function selectWithSurfaces(tabId: string): Promise<{ selected: boolean; shownWithTab: Readonly<Ref<boolean>>[] }> {
    const surfaces = options.surfacesShownWithTab ?? []
    const shownWithTab: Readonly<Ref<boolean>>[] = []
    const stop = watch([...surfaces], (open) => {
      if (options.state.value.activeTabId !== tabId) return
      surfaces.forEach((surface, index) => { if (open[index] && !shownWithTab.includes(surface)) shownWithTab.push(surface) })
    }, { flush: 'sync' })
    try {
      return { selected: await options.selectBrowserTab(tabId), shownWithTab }
    } finally {
      stop()
    }
  }

  async function focusClosing(openedBefore: readonly Readonly<Ref<boolean>>[], expectedActiveTabId?: string): Promise<boolean> {
    if (expectedActiveTabId && options.state.value.activeTabId !== expectedActiveTabId) return false

    let openAtStart = openedBefore
    const startingActiveTabId = options.state.value.activeTabId
    let focusTabId = expectedActiveTabId ?? options.state.value.activeTabId
    if (options.isHome()) {
      const tab = options.preferredWebTab()
      if (tab) {
        const { selected, shownWithTab } = await selectWithSurfaces(tab.id)
        if (selected) {
          if (options.state.value.activeTabId !== tab.id) return false
          focusTabId = tab.id
          openAtStart = [...openAtStart, ...shownWithTab]
        } else {
          if (options.state.value.activeTabId !== startingActiveTabId) return false
          focusTabId = await createFallbackTab()
        }
      } else focusTabId = await createFallbackTab()
    }
    if (!focusTabId || options.state.value.activeTabId !== focusTabId) return false
    // The person opened an overlay, panel or dialog while this waited: it keeps its place and the focus.
    if (openSurfaces().some((surface) => !openAtStart.includes(surface))) return false

    for (const overlay of overlays()) if (openAtStart.includes(overlay)) overlay.value = false
    // The update status shows itself again on each step of an update download, so it closes whenever it is open, even
    // when it showed itself while this waited. On purpose: counting it would keep the address from the focus.
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
    const openAtStart = openSurfaces()
    return (expectedActiveTabId) => focusClosing(openAtStart, expectedActiveTabId)
  }

  function focus(expectedActiveTabId?: string): Promise<boolean> {
    return begin()(expectedActiveTabId)
  }

  return { begin, focus }
}

export type AddressFocusController = ReturnType<typeof useAddressFocusController>
