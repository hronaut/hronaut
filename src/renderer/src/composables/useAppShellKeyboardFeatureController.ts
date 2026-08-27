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
    workspaceEditor: AppShellKeyboardSurface
    credentialPicker: Ref<boolean>
    helpDialog: AppShellKeyboardSurface
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
  runShortcut: (action: BrowserShortcutAction) => void
}

function refSurface(open: Ref<boolean>): ShellKeyboardSurface {
  return {
    isOpen: () => open.value,
    close: () => { open.value = false }
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
  return useShellKeyboardController({
    allInteractionLocked: options.allInteractionLocked,
    commandPalette: refSurface(options.commandPalette),
    modalSurfaces: [
      customSurface(modals.workspaceEditor),
      refSurface(modals.credentialPicker),
      customSurface(modals.helpDialog),
      customSurface(modals.settings)
    ],
    escapeSurfaces: [
      refSurface(overlays.siteStorage),
      refSurface(overlays.siteControls),
      refSurface(overlays.addressSuggestions),
      customSurface(overlays.find),
      refSurface(overlays.tabSearch),
      refSurface(overlays.splitMenu),
      refSurface(overlays.zoom),
      refSurface(collections.downloadsOpen),
      customSurface({
        open: collections.bookmarksOpen,
        close: () => collections.bookmarksPanel.value?.handleEscape()
      }),
      refSurface(collections.historyOpen),
      refSurface(pageTools.panelOpen),
      refSurface(pageTools.accessibilityPanelOpen),
      refSurface(pageTools.qualityAuditPanelOpen),
      refSurface(pageTools.performancePanelOpen),
      refSurface(pageTools.designOverviewPanelOpen),
      refSurface(pageTools.pageMetadataPanelOpen),
      refSurface(pageTools.securityPanelOpen),
      refSurface(pageTools.coveragePanelOpen),
      refSurface(pageTools.cpuProfilePanelOpen),
      refSurface(pageTools.memoryPanelOpen),
      refSurface(options.developerPanels.console),
      refSurface(pageTools.debugReportPanelOpen),
      refSurface(pageTools.reproPanelOpen),
      refSurface(pageTools.domChangesPanelOpen),
      refSurface(pageTools.visualComparePanelOpen),
      refSurface(pageTools.inspectorIssuesOpen),
      refSurface(options.developerPanels.network),
      customSurface(options.responsivePreview),
      refSurface(options.environmentPanel),
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
