import { ref } from 'vue'
import { PANEL_DOCKS, type PanelDock } from '../../../shared/types.js'
import {
  readLocalPreference,
  writeLocalPreference,
  type LocalPreferenceStorageProvider
} from '../local-preferences.js'

const PANEL_DOCK_KEY = 'hronaut:panel-dock'

export interface PanelDockPreferenceControllerOptions {
  detachedWindow: boolean
  storage?: LocalPreferenceStorageProvider
}

function isPanelDock(value: string | null): value is PanelDock {
  return value !== null && (PANEL_DOCKS as readonly string[]).includes(value)
}

export function usePanelDockPreferenceController(options: PanelDockPreferenceControllerOptions) {
  const savedDock = options.detachedWindow
    ? null
    : readLocalPreference(PANEL_DOCK_KEY, options.storage)
  const panelDock = ref<PanelDock>(
    options.detachedWindow ? 'window' : isPanelDock(savedDock) ? savedDock : 'right'
  )

  function keepsSeparatePanelOpen(): boolean {
    return options.detachedWindow || panelDock.value === 'window'
  }

  function persistDock(dock: PanelDock): void {
    writeLocalPreference(PANEL_DOCK_KEY, dock, options.storage)
  }

  return {
    panelDock,
    keepsSeparatePanelOpen,
    persistDock
  }
}

export type PanelDockPreferenceController = ReturnType<typeof usePanelDockPreferenceController>
