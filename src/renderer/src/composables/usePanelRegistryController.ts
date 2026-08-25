import { computed, type Ref } from 'vue'
import { DETACHABLE_PANEL_IDS, type DetachablePanelId } from '../../../shared/types.js'

export type DetachablePanelRegistry = Record<DetachablePanelId, Ref<boolean>>

export interface PanelRegistryControllerOptions {
  panels: DetachablePanelRegistry
  onActivate?: (panel: DetachablePanelId) => void
}

export function usePanelRegistryController(options: PanelRegistryControllerOptions) {
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
    closeAll()
    options.onActivate?.(panel)
    options.panels[panel].value = true
  }

  return { activePanelId, dockedPanelOpen, closeAll, closeAllExcept, activate }
}

export type PanelRegistryController = ReturnType<typeof usePanelRegistryController>
