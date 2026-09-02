import { ref, type Ref } from 'vue'
import { disposeAll } from './dispose-all.js'
import {
  useAppPageToolsFeatureController,
  type AppPageToolsFeatureControllerOptions
} from './useAppPageToolsFeatureController.js'
import {
  useAppPanelFeatureController,
  type AppPanelFeatureControllerOptions
} from './useAppPanelFeatureController.js'
import type { ResponsivePanelSurface } from './useAppEmulationFeatureController.js'
import type {
  ConsolePanelShellHandle,
  NetworkPanelShellHandle
} from './useDeveloperPanelsShellController.js'
import type { SiteStorageShellPanel } from './useSiteStorageShellController.js'

type PanelRegistryOptions = Omit<AppPanelFeatureControllerOptions['registry'], 'pageToolsOpen'>
type PanelDeveloperOptions = Pick<AppPanelFeatureControllerOptions['developer'], 'keepsSeparatePanelOpen'>
type PanelDetachedOptions = Omit<AppPanelFeatureControllerOptions['detached'], 'diagnostics'>

export interface AppPageToolsPanelFeatureControllerOptions {
  pageTools: AppPageToolsFeatureControllerOptions
  panel: {
    registry: PanelRegistryOptions
    transient: AppPanelFeatureControllerOptions['transient']
    developer: PanelDeveloperOptions
    detached: PanelDetachedOptions
    dock: AppPanelFeatureControllerOptions['dock']
    onError: AppPanelFeatureControllerOptions['onError']
  }
  responsivePanel: Ref<ResponsivePanelSurface | null>
  setSiteStoragePanel: (panel: SiteStorageShellPanel | null) => void
}

export function useAppPageToolsPanelFeatureController(
  options: AppPageToolsPanelFeatureControllerOptions
) {
  const pageToolsOpen = ref(false)
  const consolePanelOpen = ref(false)
  const consolePanel = ref<ConsolePanelShellHandle | null>(null)
  const networkMonitorOpen = ref(false)
  const networkPanel = ref<NetworkPanelShellHandle | null>(null)
  const pageToolsController = useAppPageToolsFeatureController(options.pageTools)
  let panelController: ReturnType<typeof useAppPanelFeatureController>

  try {
    panelController = useAppPanelFeatureController({
      ...options.panel,
      registry: {
        ...options.panel.registry,
        pageToolsOpen
      },
      developer: {
        ...options.panel.developer,
        consoleOpen: consolePanelOpen,
        consolePanel,
        networkOpen: networkMonitorOpen,
        networkPanel
      },
      detached: {
        ...options.panel.detached,
        diagnostics: pageToolsController.diagnosticsController
      }
    })
  } catch (error) {
    pageToolsController.dispose()
    throw error
  }

  const layerHandles = {
    setResponsivePanel: (panel: ResponsivePanelSurface | null) => (options.responsivePanel.value = panel),
    setConsolePanel: (panel: ConsolePanelShellHandle | null) => (consolePanel.value = panel),
    setNetworkPanel: (panel: NetworkPanelShellHandle | null) => (networkPanel.value = panel),
    setSiteStoragePanel: options.setSiteStoragePanel
  }
  let disposed = false

  function dispose(): void {
    if (disposed) return
    disposed = true
    disposeAll([panelController.dispose, pageToolsController.dispose])
  }

  return {
    pageToolsController,
    panelController,
    pageToolsOpen,
    consolePanelOpen,
    networkMonitorOpen,
    layerHandles,
    dispose
  }
}

export type AppPageToolsPanelFeatureController = ReturnType<typeof useAppPageToolsPanelFeatureController>
