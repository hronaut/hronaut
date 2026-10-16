import { computed, type ComputedRef, type Ref } from 'vue'
import type {
  DetachablePanelId,
  HronautShellApi,
  PanelDock
} from '../../../shared/types.js'
import { disposeAll } from './dispose-all.js'
import { usePanelDockLayout } from './usePanelDockLayout.js'
import { useShellOverlayCoordinationController } from './useShellOverlayCoordinationController.js'
import { useWindowControlsScrim } from './useWindowControlsScrim.js'

type BooleanState = Readonly<Ref<boolean>>
type PanelDockLayoutController = ReturnType<typeof usePanelDockLayout>

export interface AppShellLayoutFeatureControllerOptions {
  layout: {
    dock: Ref<PanelDock>
    shell: Ref<HTMLElement | null>
    dockedPanelOpen: ComputedRef<boolean>
    tabRailWidth: ComputedRef<number>
    detachedWindow: boolean
    shellApi: Pick<HronautShellApi, 'setToolbarHeight' | 'setContentInsets' | 'setBrowserContentOccluded' | 'setWindowControlsScrim'>
  }
  modals: {
    settings: BooleanState
    commandPalette: BooleanState
    helpDialog: BooleanState
    releaseHistory: BooleanState
    workspaceEditor: BooleanState
    credentialPicker: BooleanState
    walletApproval: BooleanState
  }
  overlays: {
    mcpReadiness?: Ref<boolean>
    updateNotice: BooleanState
    find: BooleanState
    zoom: BooleanState
    activePanel: Readonly<Ref<DetachablePanelId | null>>
    addressSuggestions: BooleanState
    tabSearch: BooleanState
    downloads: BooleanState
    history: BooleanState
    splitMenu: Ref<boolean>
    siteControls: BooleanState
    siteStorage: BooleanState
    bookmarks: BooleanState
  }
  keepsSeparatePanelOpen: () => boolean
  closePanelsExcept: (panel: DetachablePanelId | null) => void
  closeAddressSuggestions: () => void
}

export interface AppShellLayoutFeatureController {
  size: Ref<number>
  shellContentTop: Ref<number>
  resizeGesture: PanelDockLayoutController['resizeGesture']
  reportShellHeight: () => void
  maximumSize: (dock?: PanelDock, shellHeight?: number) => number
  minimumSize: (dock?: PanelDock, maximum?: number) => number
  startResize: (event: PointerEvent) => void
  moveResize: (event: PointerEvent) => void
  finishResize: (event: PointerEvent) => void
  resizeWithKeyboard: (event: KeyboardEvent) => void
  resetSize: () => void
  fullModalOpen: ComputedRef<boolean>
  dispose: () => void
}

export function useAppShellLayoutFeatureController(
  options: AppShellLayoutFeatureControllerOptions
): AppShellLayoutFeatureController {
  const { layout, modals, overlays } = options
  const fullModalStates = [
    modals.settings,
    modals.commandPalette,
    modals.helpDialog,
    modals.releaseHistory,
    modals.workspaceEditor,
    modals.credentialPicker,
    modals.walletApproval,
    overlays.tabSearch,
    ...(overlays.mcpReadiness ? [overlays.mcpReadiness] : [])
  ]
  const fullModalOpen = computed(() => fullModalStates.some((open) => open.value))
  const panelDockLayout = usePanelDockLayout({
    ...layout,
    fullModalOpen
  })
  const overlayCoordination = useShellOverlayCoordinationController({
    activePanel: overlays.activePanel,
    splitMenu: overlays.splitMenu,
    layoutSources: [
      ...(overlays.mcpReadiness ? [overlays.mcpReadiness] : []),
      modals.settings,
      overlays.updateNotice,
      overlays.find,
      overlays.zoom,
      overlays.activePanel,
      overlays.addressSuggestions,
      modals.commandPalette,
      modals.helpDialog,
      modals.releaseHistory,
      overlays.tabSearch,
      overlays.downloads,
      overlays.history,
      overlays.splitMenu,
      modals.workspaceEditor,
      modals.credentialPicker,
      modals.walletApproval
    ],
    competingOverlayStates: [
      ...(overlays.mcpReadiness ? [overlays.mcpReadiness] : []),
      modals.settings,
      modals.commandPalette,
      modals.helpDialog,
      modals.releaseHistory,
      modals.workspaceEditor,
      modals.credentialPicker,
      overlays.siteControls,
      overlays.siteStorage,
      overlays.addressSuggestions,
      overlays.find,
      overlays.zoom,
      overlays.splitMenu,
      overlays.tabSearch,
      overlays.downloads,
      overlays.bookmarks,
      overlays.history
    ],
    preservedPanels: [
      { panel: 'site-controls', open: overlays.siteControls },
      { panel: 'site-storage', open: overlays.siteStorage },
      { panel: 'bookmarks', open: overlays.bookmarks }
    ],
    fullModalOpen,
    keepsSeparatePanelOpen: options.keepsSeparatePanelOpen,
    closePanelsExcept: options.closePanelsExcept,
    closeAddressSuggestions: options.closeAddressSuggestions,
    setBrowserContentOccluded: (occluded) => {
      if (!layout.detachedWindow) layout.shellApi.setBrowserContentOccluded(occluded)
    },
    reportLayout: panelDockLayout.reportShellHeight
  })
  const windowControlsScrim = useWindowControlsScrim({
    sources: fullModalStates,
    report: (color) => {
      if (!layout.detachedWindow) layout.shellApi.setWindowControlsScrim(color)
    }
  })
  let disposed = false

  function dispose(): void {
    if (disposed) return
    disposed = true
    disposeAll([windowControlsScrim.dispose, overlayCoordination.dispose, panelDockLayout.dispose])
  }

  return {
    ...panelDockLayout,
    fullModalOpen,
    dispose
  }
}
