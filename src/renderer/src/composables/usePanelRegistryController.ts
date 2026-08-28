import { computed, watch, type Ref } from 'vue'
import { DETACHABLE_PANEL_IDS, type DetachablePanelId } from '../../../shared/types.js'

export type DetachablePanelRegistry = Record<DetachablePanelId, Ref<boolean>>

export interface PanelRegistryControllerOptions {
  panels: DetachablePanelRegistry
  onChange?: (panel: DetachablePanelId, open: boolean) => void
  onActivate?: (panel: DetachablePanelId) => void
}

export function usePanelRegistryController(options: PanelRegistryControllerOptions) {
  let disposed = false
  const activePanelId = computed<DetachablePanelId | null>(() => (
    DETACHABLE_PANEL_IDS.find((panel) => options.panels[panel].value) ?? null
  ))
  const dockedPanelOpen = computed(() => activePanelId.value !== null)

  function closeAllExcept(preservedPanel: DetachablePanelId | null = null): void {
    for (const panel of DETACHABLE_PANEL_IDS) {
      if (panel !== preservedPanel) options.panels[panel].value = false
    }
  }

  function closeAll(): void {
    closeAllExcept()
  }

  function activate(panel: DetachablePanelId): void {
    if (disposed) return
    closeAllExcept(panel)
    if (options.panels[panel].value) {
      options.onActivate?.(panel)
      return
    }
    options.panels[panel].value = true
  }

  const stopPanelTracking = DETACHABLE_PANEL_IDS.map((panel) => watch(
    options.panels[panel],
    (open, wasOpen) => {
      if (disposed || open === wasOpen) return
      options.onChange?.(panel, open)
      if (!open) return
      closeAllExcept(panel)
      options.onActivate?.(panel)
    },
    { flush: 'sync' }
  ))

  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const stop of stopPanelTracking) stop()
  }

  return { activePanelId, dockedPanelOpen, closeAll, closeAllExcept, activate, dispose }
}

export type PanelRegistryController = ReturnType<typeof usePanelRegistryController>
