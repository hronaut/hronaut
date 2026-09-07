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

  const stopBrowserContentOcclusionWatch = watch(options.fullModalOpen, async (open, wasOpen) => {
    // Hide a native WebContentsView before renderer-owned trusted chrome can
    // be obscured. On close, wait until the modal has left the DOM before
    // allowing website content to return.
    if (!open) {
      await nextTick()
      if (options.fullModalOpen.value) return
      // This synchronous watch queues its nextTick before the layout watch.
      // Publish current toolbar/insets before revealing the native page so it
      // never paints with the modal's stale layout, even for a single frame.
      if (!disposed && wasOpen) options.reportLayout()
    }
    if (!disposed) options.setBrowserContentOccluded(open)
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
