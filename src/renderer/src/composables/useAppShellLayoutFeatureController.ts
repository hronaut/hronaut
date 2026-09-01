import { computed, type ComputedRef, type Ref } from 'vue'
import type {
  DetachablePanelId,
  HronautShellApi,
  PanelDock
} from '../../../shared/types.js'
import { usePanelDockLayout } from './usePanelDockLayout.js'
import { useShellOverlayCoordinationController } from './useShellOverlayCoordinationController.js'

type BooleanState = Readonly<Ref<boolean>>
type PanelDockLayoutController = ReturnType<typeof usePanelDockLayout>

export interface AppShellLayoutFeatureControllerOptions {
  layout: {
    dock: Ref<PanelDock>
    shell: Ref<HTMLElement | null>
    dockedPanelOpen: ComputedRef<boolean>
    tabRailWidth: ComputedRef<number>
    detachedWindow: boolean
    shellApi: Pick<HronautShellApi, 'setToolbarHeight' | 'setContentInsets'>
  }
  modals: {
    settings: BooleanState
    commandPalette: BooleanState
    helpDialog: BooleanState
    workspaceEditor: BooleanState
    credentialPicker: BooleanState
    walletApproval: BooleanState
  }
  overlays: {
    updateNotice: BooleanState
    find: BooleanState
    zoom: BooleanState
    activePanel: Readonly<Ref<DetachablePanelId | null>>
    addressSuggestions: BooleanState
    tabSearch: BooleanState
    downloads: BooleanState
    history: BooleanState
    splitMenu: BooleanState
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
  const fullModalOpen = computed(() => modals.settings.value
    || modals.commandPalette.value
    || modals.helpDialog.value
    || modals.workspaceEditor.value
    || modals.credentialPicker.value
    || modals.walletApproval.value)
  const panelDockLayout = usePanelDockLayout({
    ...layout,
    fullModalOpen
  })
  const overlayCoordination = useShellOverlayCoordinationController({
    layoutSources: [
      modals.settings,
      overlays.updateNotice,
      overlays.find,
      overlays.zoom,
      overlays.activePanel,
      overlays.addressSuggestions,
      modals.commandPalette,
      modals.helpDialog,
      overlays.tabSearch,
      overlays.downloads,
      overlays.history,
      overlays.splitMenu,
      modals.workspaceEditor,
      modals.credentialPicker,
      modals.walletApproval
    ],
    competingOverlayStates: [
      modals.settings,
      modals.commandPalette,
      modals.helpDialog,
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
    reportLayout: panelDockLayout.reportShellHeight
  })

  return {
    ...panelDockLayout,
    fullModalOpen,
    dispose: overlayCoordination.dispose
  }
}
