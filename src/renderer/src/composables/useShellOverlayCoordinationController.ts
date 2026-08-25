import { nextTick, watch, type Ref, type WatchSource } from 'vue'
import type { DetachablePanelId } from '../../../shared/types.js'

export interface PreservedOverlayPanel {
  panel: DetachablePanelId
  open: Readonly<Ref<boolean>>
}

export interface ShellOverlayCoordinationControllerOptions {
  layoutSources: WatchSource<unknown>[]
  competingOverlayStates: Readonly<Ref<boolean>>[]
  preservedPanels: PreservedOverlayPanel[]
  fullModalOpen: Readonly<Ref<boolean>>
  keepsSeparatePanelOpen: () => boolean
  closePanelsExcept: (panel: DetachablePanelId | null) => void
  closeAddressSuggestions: () => void
  reportLayout: () => void
}

export function useShellOverlayCoordinationController(
  options: ShellOverlayCoordinationControllerOptions
) {
  let disposed = false
  const preservedPanelStates = new Set(options.preservedPanels.map(({ open }) => open))

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

  function dispose(): void {
    if (disposed) return
    disposed = true
    stopLayoutWatch()
    stopOverlayWatch()
    stopFullModalWatch()
  }

  return { dispose }
}

export type ShellOverlayCoordinationController = ReturnType<typeof useShellOverlayCoordinationController>
