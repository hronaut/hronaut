<script setup lang="ts">
import type {
  BrowserState,
  BrowserTabState,
  PanelDock,
  SupportedLocale
} from '../../../shared/types.js'
import type { AppActiveTabFeatureController } from '../composables/useAppActiveTabFeatureController.js'
import type { AppEmulationFeatureController, ResponsivePanelSurface } from '../composables/useAppEmulationFeatureController.js'
import type { AppPageToolsFeatureController } from '../composables/useAppPageToolsFeatureController.js'
import type { AppPanelFeatureController } from '../composables/useAppPanelFeatureController.js'
import type { AppSiteManagementFeatureController } from '../composables/useAppSiteManagementFeatureController.js'
import type {
  ConsolePanelShellHandle,
  NetworkPanelShellHandle
} from '../composables/useDeveloperPanelsShellController.js'
import type { SiteStorageShellPanel } from '../composables/useSiteStorageShellController.js'
import ConsolePanelContainer from './ConsolePanelContainer.vue'
import DiagnosticsPanels from './DiagnosticsPanels.vue'
import EnvironmentPanel from './EnvironmentPanel.vue'
import NetworkPanel from './NetworkPanel.vue'
import PageToolsPanel from './PageToolsPanel.vue'
import ResponsivePreviewPanel from './ResponsivePreviewPanel.vue'
import SiteStoragePanel from './SiteStoragePanel.vue'

interface AppPageToolsLayerHandles {
  setResponsivePanel: (panel: ResponsivePanelSurface | null) => void
  setConsolePanel: (panel: ConsolePanelShellHandle | null) => void
  setNetworkPanel: (panel: NetworkPanelShellHandle | null) => void
  setSiteStoragePanel: (panel: SiteStorageShellPanel | null) => void
}

const props = defineProps<{
  websiteAvailable: boolean
  activeTab?: BrowserTabState
  locale: SupportedLocale
  handles: AppPageToolsLayerHandles
  activeTabController: AppActiveTabFeatureController
  emulationController: AppEmulationFeatureController
  pageToolsController: AppPageToolsFeatureController
  panelController: AppPanelFeatureController
  siteManagementController: AppSiteManagementFeatureController
  credentialStorageAvailable: boolean
  syncState: (operation: Promise<BrowserState>) => Promise<void>
  copyText: (text: string) => Promise<boolean>
  closeTransientPanels: () => void
  openSupport: (url: string) => Promise<void>
  preservationBusy: boolean
  updatePreservation: (event: Event) => unknown
  keepsSeparatePanelOpen: () => boolean
}>()

const dock = defineModel<PanelDock>('dock', { required: true })
const pageToolsOpen = defineModel<boolean>('pageToolsOpen', { required: true })
const responsivePanelOpen = defineModel<boolean>('responsivePanelOpen', { required: true })
const environmentPanelOpen = defineModel<boolean>('environmentPanelOpen', { required: true })
const consolePanelOpen = defineModel<boolean>('consolePanelOpen', { required: true })
const networkMonitorOpen = defineModel<boolean>('networkMonitorOpen', { required: true })
const siteStorageOpen = defineModel<boolean>('siteStorageOpen', { required: true })

const {
  activeWebUrl,
  activeHostname,
  activeCredentials,
  fillSavedPassword
} = props.activeTabController
const {
  activeEmulation,
  environmentState,
  activeEnvironmentOverrideCount,
  setResponsiveTabViewport,
  beginEmulationMutation,
  isEmulationMutationCurrent,
  toggleResponsivePreview,
  toggleEnvironment
} = props.emulationController
const {
  diagnosticsController,
  elementPickerState,
  elementPickerMode,
  areaCaptureState,
  toggleElementPicker,
  pageSnapshotState,
  pdfExportState,
  copyPageSnapshot,
  saveActivePdf,
  pageToolsLabels,
  activeNetworkRouteCount,
  activeInspectorIssueCount,
  debugReportSignalCount
} = props.pageToolsController
const {
  toggleConsole,
  toggleNetworkMonitor,
  openRequestConditions
} = props.panelController
const { toggleSiteStorage } = props.siteManagementController

function setResponsivePanel(value: unknown): void {
  props.handles.setResponsivePanel(value as ResponsivePanelSurface | null)
}

function setConsolePanel(value: unknown): void {
  props.handles.setConsolePanel(value as ConsolePanelShellHandle | null)
}

function setNetworkPanel(value: unknown): void {
  props.handles.setNetworkPanel(value as NetworkPanelShellHandle | null)
}

function setSiteStoragePanel(value: unknown): void {
  props.handles.setSiteStoragePanel(value as SiteStorageShellPanel | null)
}
</script>

<template>
  <PageToolsPanel
    v-if="websiteAvailable"
    v-model:open="pageToolsOpen"
    v-model:dock="dock"
    :active-tab="activeTab"
    :active-web-url="activeWebUrl"
    :hostname="activeHostname"
    :locale="locale"
    :active-emulation="activeEmulation"
    :environment-state="environmentState"
    :environment-override-count="activeEnvironmentOverrideCount"
    :network-route-count="activeNetworkRouteCount"
    :inspector-issue-count="activeInspectorIssueCount"
    :debug-report-signal-count="debugReportSignalCount"
    :element-picker-state="elementPickerState"
    :element-picker-mode="elementPickerMode"
    :capture-busy="areaCaptureState === 'capturing'"
    :snapshot-state="pageSnapshotState"
    :pdf-state="pdfExportState"
    :credential-storage-available="credentialStorageAvailable"
    :credential-count="activeCredentials.length"
    :diagnostics="diagnosticsController"
    :labels="pageToolsLabels"
    :actions="{
      toggleSiteStorage,
      toggleResponsivePreview,
      toggleEnvironment,
      toggleConsole,
      toggleNetwork: toggleNetworkMonitor,
      openRequestConditions,
      toggleElementPicker,
      copyPageSnapshot,
      savePdf: saveActivePdf,
      fillSavedPassword
    }"
  />
  <ResponsivePreviewPanel
    :ref="setResponsivePanel"
    v-model:open="responsivePanelOpen"
    v-model:dock="dock"
    :active-tab="activeTab"
    :locale="locale"
    :set-tab-viewport="setResponsiveTabViewport"
    :sync-state="syncState"
    :begin-mutation="beginEmulationMutation"
    :is-mutation-current="isEmulationMutationCurrent"
    :close-transient-panels="closeTransientPanels"
  />
  <EnvironmentPanel
    v-model:open="environmentPanelOpen"
    v-model:dock="dock"
    :active-tab="activeTab"
    :locale="locale"
    :controller="emulationController.environmentController"
    :open-responsive-preview="toggleResponsivePreview"
  />
  <DiagnosticsPanels
    v-model:dock="dock"
    :active-tab="activeTab"
    :locale="locale"
    :controller="diagnosticsController"
    :open-support="openSupport"
    :preservation-busy="preservationBusy"
    :update-preservation="updatePreservation"
  />
  <ConsolePanelContainer
    :ref="setConsolePanel"
    v-model:open="consolePanelOpen"
    v-model:dock="dock"
    :active-tab="activeTab"
    :locale="locale"
    :copy-text="copyText"
    :preservation-busy="preservationBusy"
    :update-preservation="updatePreservation"
    :keeps-separate-panel-open="keepsSeparatePanelOpen"
  />
  <NetworkPanel
    :ref="setNetworkPanel"
    v-model:open="networkMonitorOpen"
    v-model:dock="dock"
    :active-tab="activeTab"
    :locale="locale"
    :copy-text="copyText"
    :sync-state="syncState"
    :preservation-busy="preservationBusy"
    :update-preservation="updatePreservation"
    :keeps-separate-panel-open="keepsSeparatePanelOpen"
  />
  <SiteStoragePanel
    :ref="setSiteStoragePanel"
    v-model:open="siteStorageOpen"
    v-model:dock="dock"
    :active-tab="activeTab"
    :locale="locale"
    :copy-text="copyText"
    :keeps-separate-panel-open="keepsSeparatePanelOpen"
  />
</template>
