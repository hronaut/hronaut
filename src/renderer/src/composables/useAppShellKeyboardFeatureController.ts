import type { Ref } from 'vue'
import type { BrowserShortcutAction } from '../../../shared/browser-shortcuts.js'
import type { AppBrowserCollectionsFeatureController } from './useAppBrowserCollectionsFeatureController.js'
import type { AppPageToolsFeatureController } from './useAppPageToolsFeatureController.js'
import {
  useShellKeyboardController,
  type ShellKeyboardSurface
} from './useShellKeyboardController.js'

export interface AppShellKeyboardSurface {
  open: Readonly<Ref<boolean>>
  close: () => void
}

type CollectionSurfaces = Pick<
  AppBrowserCollectionsFeatureController,
  'downloadsOpen' | 'bookmarksOpen' | 'bookmarksPanel' | 'historyOpen'
>

type PageToolsSurfaces = Pick<
  AppPageToolsFeatureController,
  | 'accessibilityPanelOpen'
  | 'qualityAuditPanelOpen'
  | 'performancePanelOpen'
  | 'designOverviewPanelOpen'
  | 'pageMetadataPanelOpen'
  | 'securityPanelOpen'
  | 'coveragePanelOpen'
  | 'cpuProfilePanelOpen'
  | 'memoryPanelOpen'
  | 'debugReportPanelOpen'
  | 'reproPanelOpen'
  | 'domChangesPanelOpen'
  | 'visualComparePanelOpen'
  | 'inspectorIssuesOpen'
  | 'areaCaptureState'
  | 'elementPickerState'
  | 'toggleAreaCapture'
  | 'cancelActiveElementPicker'
> & { panelOpen: Ref<boolean> }

export interface AppShellKeyboardFeatureControllerOptions {
  allInteractionLocked: () => boolean
  commandPalette: Ref<boolean>
  modals: {
    walletApproval: AppShellKeyboardSurface
    /** Main's own question, such as a website's permission request; it sits above every other dialog. */
    trustedDialog: AppShellKeyboardSurface
    agentSteps: AppShellKeyboardSurface
    workspaceEditor: AppShellKeyboardSurface
    credentialPicker: Ref<boolean>
    releaseHistory: AppShellKeyboardSurface
    helpDialog: AppShellKeyboardSurface
    taskManager: AppShellKeyboardSurface
    settings: AppShellKeyboardSurface
  }
  overlays: {
    siteStorage: Ref<boolean>
    siteControls: Ref<boolean>
    addressSuggestions: Ref<boolean>
    find: AppShellKeyboardSurface
    tabSearch: Ref<boolean>
    splitMenu: Ref<boolean>
    zoom: Ref<boolean>
    updateNotice: Ref<boolean>
  }
  collections: CollectionSurfaces
  pageTools: PageToolsSurfaces
  developerPanels: {
    console: Ref<boolean>
    network: Ref<boolean>
  }
  responsivePreview: AppShellKeyboardSurface
  environmentPanel: Ref<boolean>
  /** True while the panels that can move to their own window, such as Site storage, are shown there. */
  panelsInOwnWindow: () => boolean
  runShortcut: (action: BrowserShortcutAction) => void
}

function refSurface(open: Ref<boolean>, toggleShortcut?: BrowserShortcutAction): ShellKeyboardSurface {
  return {
    isOpen: () => open.value,
    close: () => { open.value = false },
    toggleShortcut
  }
}

function customSurface(surface: AppShellKeyboardSurface): ShellKeyboardSurface {
  return {
    isOpen: () => surface.open.value,
    close: surface.close
  }
}

export function useAppShellKeyboardFeatureController(
  options: AppShellKeyboardFeatureControllerOptions
) {
  const { modals, overlays, collections, pageTools } = options
  const panel = (surface: ShellKeyboardSurface): ShellKeyboardSurface => ({
    ...surface,
    inOwnWindow: options.panelsInOwnWindow
  })
  return useShellKeyboardController({
    allInteractionLocked: options.allInteractionLocked,
    commandPalette: refSurface(options.commandPalette),
    modalSurfaces: [
      customSurface(modals.trustedDialog),
      customSurface(modals.walletApproval),
      customSurface(modals.agentSteps),
      customSurface(modals.workspaceEditor),
      refSurface(modals.credentialPicker),
      customSurface(modals.releaseHistory),
      customSurface(modals.helpDialog),
      customSurface(modals.taskManager),
      refSurface(overlays.tabSearch, 'search-tabs')
    ],
    escapeSurfaces: [
      panel(refSurface(overlays.siteStorage)),
      panel(refSurface(overlays.siteControls)),
      refSurface(overlays.addressSuggestions),
      customSurface(overlays.find),
      refSurface(overlays.splitMenu),
      refSurface(overlays.zoom),
      refSurface(collections.downloadsOpen),
      panel(customSurface({
        open: collections.bookmarksOpen,
        close: () => collections.bookmarksPanel.value?.handleEscape()
      })),
      refSurface(collections.historyOpen),
      panel(refSurface(pageTools.panelOpen)),
      panel(refSurface(pageTools.accessibilityPanelOpen)),
      panel(refSurface(pageTools.qualityAuditPanelOpen)),
      panel(refSurface(pageTools.performancePanelOpen)),
      panel(refSurface(pageTools.designOverviewPanelOpen)),
      panel(refSurface(pageTools.pageMetadataPanelOpen)),
      panel(refSurface(pageTools.securityPanelOpen)),
      panel(refSurface(pageTools.coveragePanelOpen)),
      panel(refSurface(pageTools.cpuProfilePanelOpen)),
      panel(refSurface(pageTools.memoryPanelOpen)),
      panel(refSurface(options.developerPanels.console)),
      panel(refSurface(pageTools.debugReportPanelOpen)),
      panel(refSurface(pageTools.reproPanelOpen)),
      panel(refSurface(pageTools.domChangesPanelOpen)),
      panel(refSurface(pageTools.visualComparePanelOpen)),
      panel(refSurface(pageTools.inspectorIssuesOpen)),
      panel(refSurface(options.developerPanels.network)),
      panel(customSurface(options.responsivePreview)),
      panel(refSurface(options.environmentPanel)),
      {
        isOpen: () => pageTools.areaCaptureState.value === 'picking',
        close: () => { void pageTools.toggleAreaCapture() }
      },
      {
        isOpen: () => pageTools.elementPickerState.value === 'picking',
        close: () => { void pageTools.cancelActiveElementPicker() }
      },
      refSurface(overlays.updateNotice)
    ],
    runShortcut: options.runShortcut
  })
}

export type AppShellKeyboardFeatureController = ReturnType<
  typeof useAppShellKeyboardFeatureController
>
