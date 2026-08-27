import type { Ref } from 'vue'
import type {
  DetachablePanelId,
  HronautPanelWindowApi,
  PanelDock
} from '../../../shared/types.js'
import { disposeAll } from './dispose-all.js'
import { useDetachedPanelActionsController } from './useDetachedPanelActionsController.js'
import {
  useDetachedPanelRefreshController,
  type DetachedPanelRefreshContext
} from './useDetachedPanelRefreshController.js'
import {
  useDeveloperPanelsShellController,
  type ConsolePanelShellHandle,
  type NetworkPanelShellHandle
} from './useDeveloperPanelsShellController.js'
import type { DiagnosticsController } from './useDiagnosticsController.js'
import { usePanelRegistryController } from './usePanelRegistryController.js'
import { usePanelWindowEventsController } from './usePanelWindowEventsController.js'
import { usePanelWindowSyncController } from './usePanelWindowSyncController.js'
import { useTransientPanelsController } from './useTransientPanelsController.js'

export interface AppPanelFeatureControllerOptions {
  registry: {
    siteControlsOpen: Ref<boolean>
    siteStorageOpen: Ref<boolean>
    pageToolsOpen: Ref<boolean>
    responsivePanelOpen: Ref<boolean>
    environmentPanelOpen: Ref<boolean>
    bookmarksOpen: Ref<boolean>
    onActivate: (panel: DetachablePanelId) => void
  }
  transient: {
    shouldCloseDockedPanels: () => boolean
    addressSuggestionsOpen: Ref<boolean>
    zoomOpen: Ref<boolean>
    downloadsOpen: Ref<boolean>
    historyOpen: Ref<boolean>
    tabSearchOpen: Ref<boolean>
    updateNoticeOpen: Ref<boolean>
    findOpen: Ref<boolean>
    closeFind: () => Promise<void>
  }
  developer: {
    consoleOpen: Ref<boolean>
    consolePanel: Readonly<Ref<ConsolePanelShellHandle | null>>
    networkOpen: Ref<boolean>
    networkPanel: Readonly<Ref<NetworkPanelShellHandle | null>>
    keepsSeparatePanelOpen: () => boolean
  }
  detached: {
    panelId: DetachablePanelId | null
    detachedWindow: boolean
    api: HronautPanelWindowApi
    context: () => DetachedPanelRefreshContext
    refreshSiteData: () => unknown
    refreshSiteStorage: () => unknown
    loadResponsiveDraft: () => unknown
    loadEnvironmentDraft: () => unknown
    diagnostics: DiagnosticsController
    waitForPresentationTurn?: () => Promise<void>
  }
  dock: {
    panelDock: Ref<PanelDock>
    persistDock: (dock: PanelDock) => void
  }
  onError: (error: unknown) => void
}

export function useAppPanelFeatureController(options: AppPanelFeatureControllerOptions) {
  const panelRegistryController = usePanelRegistryController({
    panels: {
      'site-controls': options.registry.siteControlsOpen,
      'site-storage': options.registry.siteStorageOpen,
      'page-tools': options.registry.pageToolsOpen,
      'responsive-preview': options.registry.responsivePanelOpen,
      environment: options.registry.environmentPanelOpen,
      accessibility: options.detached.diagnostics.accessibilityPanelOpen,
      'quality-audit': options.detached.diagnostics.qualityAuditPanelOpen,
      performance: options.detached.diagnostics.performancePanelOpen,
      'design-overview': options.detached.diagnostics.designOverviewPanelOpen,
      'page-metadata': options.detached.diagnostics.pageMetadataPanelOpen,
      security: options.detached.diagnostics.securityPanelOpen,
      coverage: options.detached.diagnostics.coveragePanelOpen,
      'cpu-profile': options.detached.diagnostics.cpuProfilePanelOpen,
      memory: options.detached.diagnostics.memoryPanelOpen,
      console: options.developer.consoleOpen,
      network: options.developer.networkOpen,
      'debug-report': options.detached.diagnostics.debugReportPanelOpen,
      'repro-recorder': options.detached.diagnostics.reproPanelOpen,
      'dom-changes': options.detached.diagnostics.domChangesPanelOpen,
      'visual-compare': options.detached.diagnostics.visualComparePanelOpen,
      issues: options.detached.diagnostics.inspectorIssuesOpen,
      bookmarks: options.registry.bookmarksOpen
    },
    onActivate: options.registry.onActivate
  })
  const {
    activePanelId,
    dockedPanelOpen,
    closeAll: closeDockedPanels,
    closeAllExcept: closeDockedPanelsExcept,
    activate: activatePanel
  } = panelRegistryController
  const transientPanelsController = useTransientPanelsController({
    shouldCloseDockedPanels: options.transient.shouldCloseDockedPanels,
    closeDockedPanels,
    addressSuggestionsOpen: options.transient.addressSuggestionsOpen,
    zoomOpen: options.transient.zoomOpen,
    downloadsOpen: options.transient.downloadsOpen,
    historyOpen: options.transient.historyOpen,
    tabSearchOpen: options.transient.tabSearchOpen,
    updateNoticeOpen: options.transient.updateNoticeOpen,
    findOpen: options.transient.findOpen,
    closeFind: options.transient.closeFind,
    onError: options.onError
  })
  const developerPanelsShellController = useDeveloperPanelsShellController({
    consoleOpen: options.developer.consoleOpen,
    consolePanel: options.developer.consolePanel,
    networkOpen: options.developer.networkOpen,
    networkPanel: options.developer.networkPanel,
    closeTransientPanels: transientPanelsController.close,
    keepsSeparatePanelOpen: options.developer.keepsSeparatePanelOpen
  })
  const {
    resetConsole: resetConsoleView,
    toggleConsole,
    resetNetwork: resetNetworkMonitorView,
    toggleNetwork: toggleNetworkMonitor,
    openRequestConditions
  } = developerPanelsShellController
  const { refresh: refreshDetachedPanel } = useDetachedPanelActionsController({
    refreshSiteData: options.detached.refreshSiteData,
    refreshSiteStorage: options.detached.refreshSiteStorage,
    loadResponsiveDraft: options.detached.loadResponsiveDraft,
    loadEnvironmentDraft: options.detached.loadEnvironmentDraft,
    diagnostics: options.detached.diagnostics,
    developerPanels: developerPanelsShellController
  })

  if (options.detached.panelId) activatePanel(options.detached.panelId)

  const detachedPanelRefreshController = useDetachedPanelRefreshController({
    detachedWindow: options.detached.detachedWindow,
    activePanelId,
    context: options.detached.context,
    activate: activatePanel,
    refresh: refreshDetachedPanel,
    onError: options.onError,
    waitForPresentationTurn: options.detached.waitForPresentationTurn
  })
  const panelWindowEventsController = usePanelWindowEventsController({
    api: options.detached.api,
    detachedWindow: options.detached.detachedWindow,
    showDetachedPanel: detachedPanelRefreshController.show,
    activateMainPanel: activatePanel,
    redockMainPanel: ({ panel, dock }) => {
      options.dock.panelDock.value = dock
      activatePanel(panel)
    },
    closeMainPanels: closeDockedPanels,
    onError: options.onError
  })
  const panelWindowSyncController = usePanelWindowSyncController({
    api: options.detached.api,
    detachedWindow: options.detached.detachedWindow,
    panelDock: options.dock.panelDock,
    activePanelId,
    syncingMainPanelState: panelWindowEventsController.syncingMainPanelState,
    persistDock: options.dock.persistDock,
    onError: options.onError
  })
  let disposed = false

  function dispose(): void {
    if (disposed) return
    disposed = true
    disposeAll([
      detachedPanelRefreshController.dispose,
      panelWindowSyncController.dispose,
      panelWindowEventsController.dispose,
      developerPanelsShellController.dispose
    ])
  }

  return {
    panelRegistryController,
    transientPanelsController,
    developerPanelsShellController,
    detachedPanelRefreshController,
    panelWindowEventsController,
    panelWindowSyncController,
    activePanelId,
    dockedPanelOpen,
    closeDockedPanels,
    closeDockedPanelsExcept,
    activatePanel,
    resetConsoleView,
    toggleConsole,
    resetNetworkMonitorView,
    toggleNetworkMonitor,
    openRequestConditions,
    dispose
  }
}

export type AppPanelFeatureController = ReturnType<typeof useAppPanelFeatureController>
