import { nextTick, watch, type Ref, type WatchSource } from 'vue'
import type { DetachablePanelId } from '../../../shared/types.js'

export interface PreservedOverlayPanel {
  panel: DetachablePanelId
  open: Readonly<Ref<boolean>>
}

export interface ShellOverlayCoordinationControllerOptions {
  activePanel: Readonly<Ref<DetachablePanelId | null>>
  splitMenu: Ref<boolean>
  layoutSources: WatchSource<unknown>[]
  competingOverlayStates: Readonly<Ref<boolean>>[]
  preservedPanels: PreservedOverlayPanel[]
  fullModalOpen: Readonly<Ref<boolean>>
  /** When the page views must be hidden; defaults to while a full modal is open. */
  browserContentOccluded?: Readonly<Ref<boolean>>
  keepsSeparatePanelOpen: () => boolean
  closePanelsExcept: (panel: DetachablePanelId | null) => void
  closeAddressSuggestions: () => void
  setBrowserContentOccluded: (occluded: boolean) => void
  reportLayout: () => void
}

export function useShellOverlayCoordinationController(
  options: ShellOverlayCoordinationControllerOptions
) {
  let disposed = false
  const preservedPanelStates = new Set(options.preservedPanels.map(({ open }) => open))

  // A panel opened after Split view must release the menu's native content inset.
  // Detached panels do not consume browser space; docking one back does.
  const stopPanelWatch = watch(
    [options.activePanel, options.keepsSeparatePanelOpen],
    ([panel, separate]) => {
      if (panel && !separate) options.splitMenu.value = false
    },
    { flush: 'sync' }
  )

  const stopLayoutWatch = watch(options.layoutSources, async () => {
    await nextTick()
    if (!disposed) options.reportLayout()
  })

  const stopOverlayWatch = watch(options.competingOverlayStates, (openStates) => {
    if (!openStates.some(Boolean) || options.keepsSeparatePanelOpen()) return
    const nonPanelOverlayOpen = options.competingOverlayStates.some((open) => (
      open.value && !preservedPanelStates.has(open)
    ))
    const preservedPanel = nonPanelOverlayOpen
      ? null
      : options.preservedPanels.find(({ open }) => open.value)?.panel ?? null
    options.closePanelsExcept(preservedPanel)
  })

  // The suggestions are hosted in a topmost native WebContentsView. Closing it
  // synchronously prevents the native surface from covering a renderer modal.
  const stopFullModalWatch = watch(options.fullModalOpen, (open) => {
    if (open) options.closeAddressSuggestions()
  }, { flush: 'sync' })

  const browserContentOccluded = options.browserContentOccluded ?? options.fullModalOpen
  // A modal that closes into its exit transition flips the state back within one
  // update; report only real changes.
  let reportedOccluded: boolean | null = null
  let occlusionChange = 0
  const stopBrowserContentOcclusionWatch = watch(browserContentOccluded, async (open) => {
    const change = ++occlusionChange
    // Hide a native WebContentsView before renderer-owned trusted chrome can
    // be obscured. On close, wait until the modal has left the DOM before
    // allowing website content to return.
    if (!open) {
      // This watch can run before the closing overlay's render is even queued,
      // so wait for that render, where its exit starts and may keep the page hidden.
      await nextTick()
      await nextTick()
      // A newer change decides, such as the exit that started in that render.
      if (change !== occlusionChange || browserContentOccluded.value) return
      // Publish current toolbar/insets before revealing the native page so it
      // never paints with the modal's stale layout, even for a single frame.
      if (!disposed && reportedOccluded) options.reportLayout()
    }
    if (disposed || reportedOccluded === open) return
    reportedOccluded = open
    options.setBrowserContentOccluded(open)
  }, { flush: 'sync', immediate: true })

  function dispose(): void {
    if (disposed) return
    disposed = true
    stopPanelWatch()
    stopLayoutWatch()
    stopOverlayWatch()
    stopFullModalWatch()
    stopBrowserContentOcclusionWatch()
    options.setBrowserContentOccluded(false)
  }

  return { dispose }
}

export type ShellOverlayCoordinationController = ReturnType<typeof useShellOverlayCoordinationController>
