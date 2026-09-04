<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAccessibility from '~icons/material-symbols/accessibility-new-rounded'
import IconAccountTree from '~icons/material-symbols/account-tree-rounded'
import IconAdsClick from '~icons/material-symbols/ads-click-rounded'
import IconBugReport from '~icons/material-symbols/bug-report-rounded'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconCode from '~icons/material-symbols/code-rounded'
import IconDatabase from '~icons/material-symbols/database-rounded'
import IconDevices from '~icons/material-symbols/devices-rounded'
import IconDifference from '~icons/material-symbols/difference-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconFactCheck from '~icons/material-symbols/fact-check-rounded'
import IconLanguage from '~icons/material-symbols/language-rounded'
import IconMemory from '~icons/material-symbols/memory-rounded'
import IconMonitoring from '~icons/material-symbols/monitoring-rounded'
import IconNetworkCheck from '~icons/material-symbols/network-check-rounded'
import IconPalette from '~icons/material-symbols/palette-rounded'
import IconPassword from '~icons/material-symbols/password-rounded'
import IconPdf from '~icons/material-symbols/picture-as-pdf-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRecord from '~icons/material-symbols/fiber-manual-record-rounded'
import IconRoute from '~icons/material-symbols/route-rounded'
import IconScreenshotRegion from '~icons/material-symbols/screenshot-region-rounded'
import IconShieldLock from '~icons/material-symbols/shield-lock-rounded'
import IconSpeed from '~icons/material-symbols/speed-rounded'
import IconTerminal from '~icons/material-symbols/terminal-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import { formatNumber } from '../../../shared/format'
import type {
  BrowserEmulationState,
  BrowserTabState,
  PanelDock,
  SupportedLocale
} from '../../../shared/types'
import type { DiagnosticsController } from '../composables/useDiagnosticsController'
import type { PageToolsLabels } from '../composables/usePageToolsPresentationController'
import PanelDockPicker from './PanelDockPicker.vue'

export interface PageToolsActions {
  toggleSiteStorage: () => void | Promise<void>
  toggleResponsivePreview: () => void
  toggleEnvironment: () => void
  toggleConsole: () => void
  toggleNetwork: () => void
  openRequestConditions: () => void | Promise<void>
  toggleElementPicker: (mode: 'context' | 'screenshot') => void | Promise<void>
  copyPageSnapshot: () => void | Promise<void>
  savePdf: () => void | Promise<void>
  fillSavedPassword: () => void | Promise<void>
}

const props = defineProps<{
  activeTab?: BrowserTabState
  activeWebUrl: string | null
  hostname: string
  locale: SupportedLocale
  activeEmulation?: BrowserEmulationState
  environmentState: 'idle' | 'applying' | 'applied' | 'error'
  environmentOverrideCount: number
  networkRouteCount: number
  inspectorIssueCount: number
  debugReportSignalCount: number
  elementPickerState: 'idle' | 'picking' | 'copied' | 'error'
  elementPickerMode: 'context' | 'screenshot'
  captureBusy: boolean
  snapshotState: 'idle' | 'copying' | 'copied' | 'error'
  pdfState: 'idle' | 'saving' | 'saved' | 'error'
  credentialStorageAvailable: boolean
  credentialCount: number
  labels: PageToolsLabels
  actions: PageToolsActions
  diagnostics: DiagnosticsController
}>()

const open = defineModel<boolean>('open', { required: true })
const dock = defineModel<PanelDock>('dock', { required: true })
const labels = toRef(props, 'labels')
const actions = toRef(props, 'actions')
const { t } = useI18n({ useScope: 'global' })
const localNumber = (value: number): string => formatNumber(props.locale, value)
const {
  accessibilityAuditState,
  accessibilityAudit,
  qualityAuditState,
  qualityAuditReport,
  performanceState,
  designOverviewReport,
  designOverviewState,
  pageMetadataReport,
  pageMetadataState,
  securityReport,
  securityReportState,
  coverageResult,
  coverageState,
  cpuProfileResult,
  cpuProfileState,
  memoryState,
  debugReportState,
  visualCompareReport,
  visualCompareState,
  togglePerformanceReport,
  toggleDesignOverview,
  togglePageMetadata,
  toggleSecurityReport,
  toggleCodeCoverage,
  toggleCpuProfile,
  toggleMemoryReport,
  toggleDebugReport,
  toggleReproRecorder,
  toggleDomChanges,
  toggleVisualCompare,
  toggleInspectorIssues,
  toggleAccessibilityAudit,
  toggleQualityAudit
} = props.diagnostics

function closeAndRun(action: () => void | Promise<void>): void {
  open.value = false
  void action()
}
</script>

<template>
  <section
    v-if="open"
    id="page-tools-panel"
    class="page-tools-panel"
    data-shell-docked-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="page-tools-title"
  >
    <header>
      <div><span class="eyebrow">{{ t('shell.pageTools.current') }}</span><h2 id="page-tools-title">{{ t('shell.pageTools.heading') }}</h2></div>
      <div class="panel-header-actions">
        <PanelDockPicker v-model="dock" :label="t('runtime.tabs.dockPageTools')" />
        <UiButton native class="panel-close" type="button" :aria-label="t('shell.pageTools.close')" @click="open = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div class="page-tools-content">
      <section aria-labelledby="page-tools-inspect-title">
        <h3 id="page-tools-inspect-title">{{ t('shell.pageTools.inspect') }}</h3>
        <div class="page-tools-grid">
          <UiButton native type="button" :aria-label="activeWebUrl ? t('runtime.tabs.siteStorage', { host: hostname }) : t('runtime.tabs.siteStorageUnavailable')" :disabled="!activeWebUrl" @click="actions.toggleSiteStorage">
            <IconDatabase aria-hidden="true" /><span><strong>{{ t('panels.siteStorage') }}</strong><small>{{ t('shell.pageTools.storageDescription') }}</small></span>
          </UiButton>
          <UiButton native :class="{ complete: Boolean(activeEmulation?.viewport) }" type="button" :aria-label="t('runtime.address.responsive', { status: labels.responsive })" @click="actions.toggleResponsivePreview">
            <IconDevices aria-hidden="true" /><span><strong>{{ t('shell.pageTools.responsive') }}</strong><small>{{ labels.responsive }}</small></span>
          </UiButton>
          <UiButton native :class="{ complete: environmentOverrideCount > 0, error: environmentState === 'error', running: environmentState === 'applying' }" type="button" :aria-label="t('runtime.address.environment', { status: labels.environment })" :disabled="environmentState === 'applying'" @click="actions.toggleEnvironment">
            <IconProgress v-if="environmentState === 'applying'" class="state-spinner" aria-hidden="true" /><IconSpeed v-else aria-hidden="true" />
            <span><strong>{{ t('shell.pageTools.environment') }}</strong><small>{{ labels.environment }}</small></span>
          </UiButton>
          <UiButton native type="button" :aria-label="t('shell.pageTools.openConsole')" @click="actions.toggleConsole"><IconTerminal aria-hidden="true" /><span><strong>{{ t('panels.console') }}</strong><small>{{ t('shell.pageTools.consoleDescription') }}</small></span></UiButton>
          <UiButton native type="button" :aria-label="t('shell.pageTools.openNetwork')" @click="actions.toggleNetwork"><IconNetworkCheck aria-hidden="true" /><span><strong>{{ t('panels.network') }}</strong><small>{{ t('shell.pageTools.networkDescription') }}</small></span></UiButton>
          <UiButton native :class="{ warning: networkRouteCount > 0 }" type="button" :aria-label="t('runtime.address.conditions', { status: networkRouteCount ? t('network.conditions.active', { count: localNumber(networkRouteCount) }, networkRouteCount) : t('runtime.address.noneActive') })" @click="actions.openRequestConditions">
            <IconRoute aria-hidden="true" /><span><strong>{{ t('shell.pageTools.conditions') }}</strong><small>{{ networkRouteCount ? t('network.conditions.active', { count: localNumber(networkRouteCount) }, networkRouteCount) : t('shell.pageTools.conditionsDescription') }}</small></span>
          </UiButton>
        </div>
      </section>
      <section aria-labelledby="page-tools-diagnose-title">
        <h3 id="page-tools-diagnose-title">{{ t('shell.pageTools.diagnose') }}</h3>
        <div class="page-tools-grid">
          <UiButton native :class="{ warning: inspectorIssueCount > 0 }" type="button" :aria-label="t('issues.toolAria', { status: labels.inspectorIssues })" @click="toggleInspectorIssues"><IconWarning aria-hidden="true" /><span><strong>{{ t('panels.issues') }}</strong><small>{{ labels.inspectorIssues }}</small></span></UiButton>
          <UiButton native :class="{ complete: securityReport?.state === 'secure', warning: securityReport?.state === 'insecure' || securityReport?.state === 'insecure-broken', error: securityReportState === 'error', running: securityReportState === 'loading' }" type="button" :aria-label="t('securityReport.toolAria', { status: labels.security })" :disabled="securityReportState === 'loading'" @click="toggleSecurityReport">
            <IconProgress v-if="securityReportState === 'loading'" class="state-spinner" aria-hidden="true" /><IconShieldLock v-else aria-hidden="true" /><span><strong>{{ t('panels.security') }}</strong><small>{{ labels.security }}</small></span>
          </UiButton>
          <UiButton native :class="{ complete: debugReportState === 'complete' && !debugReportSignalCount, warning: debugReportState === 'complete' && Boolean(debugReportSignalCount), error: debugReportState === 'error', running: debugReportState === 'running' }" type="button" :aria-label="labels.debugReport" :disabled="debugReportState === 'running'" @click="toggleDebugReport">
            <IconProgress v-if="debugReportState === 'running'" class="state-spinner" aria-hidden="true" /><IconCheck v-else-if="debugReportState === 'complete' && !debugReportSignalCount" aria-hidden="true" /><IconError v-else-if="debugReportState === 'error'" aria-hidden="true" /><IconBugReport v-else aria-hidden="true" /><span><strong>{{ t('panels.debugReport') }}</strong><small>{{ labels.debugReport }}</small></span>
          </UiButton>
          <UiButton native :class="{ running: activeTab?.reproRecording?.active }" type="button" :aria-label="t('repro.toolAria', { status: labels.repro })" @click="toggleReproRecorder"><IconRecord aria-hidden="true" /><span><strong>{{ t('panels.reproRecorder') }}</strong><small>{{ labels.repro }}</small></span></UiButton>
          <UiButton native :class="{ running: activeTab?.domChangesRecording?.active }" type="button" :aria-label="t('domChanges.toolAria', { status: labels.domChanges })" @click="toggleDomChanges"><IconAccountTree aria-hidden="true" /><span><strong>{{ t('panels.domChanges') }}</strong><small>{{ labels.domChanges }}</small></span></UiButton>
          <UiButton native :class="{ complete: visualCompareReport?.status === 'compared' && visualCompareReport.identical, warning: visualCompareReport?.status === 'compared' && !visualCompareReport.identical, error: visualCompareState === 'error', running: visualCompareState === 'loading' }" type="button" :aria-label="t('visualCompare.toolAria', { status: labels.visualCompare })" :disabled="visualCompareState === 'loading'" @click="toggleVisualCompare">
            <IconProgress v-if="visualCompareState === 'loading'" class="state-spinner" aria-hidden="true" /><IconDifference v-else aria-hidden="true" /><span><strong>{{ t('panels.visualCompare') }}</strong><small>{{ labels.visualCompare }}</small></span>
          </UiButton>
          <UiButton native :class="{ picking: elementPickerMode === 'context' && elementPickerState === 'picking', copied: elementPickerMode === 'context' && elementPickerState === 'copied', error: elementPickerMode === 'context' && elementPickerState === 'error' }" type="button" :aria-label="labels.contextPicker" :disabled="captureBusy" @click="closeAndRun(() => actions.toggleElementPicker('context'))">
            <IconCheck v-if="elementPickerMode === 'context' && elementPickerState === 'copied'" aria-hidden="true" /><IconClose v-else-if="elementPickerMode === 'context' && elementPickerState === 'picking'" aria-hidden="true" /><IconAdsClick v-else aria-hidden="true" /><span><strong>{{ t('shell.pageTools.pickElement') }}</strong><small>{{ t('shell.pageTools.pickDescription') }}</small></span>
          </UiButton>
          <UiButton native :class="{ picking: elementPickerMode === 'screenshot' && elementPickerState === 'picking', copied: elementPickerMode === 'screenshot' && elementPickerState === 'copied', error: elementPickerMode === 'screenshot' && elementPickerState === 'error' }" type="button" :aria-label="labels.elementScreenshot" :disabled="captureBusy" @click="closeAndRun(() => actions.toggleElementPicker('screenshot'))">
            <IconCheck v-if="elementPickerMode === 'screenshot' && elementPickerState === 'copied'" aria-hidden="true" /><IconClose v-else-if="elementPickerMode === 'screenshot' && elementPickerState === 'picking'" aria-hidden="true" /><IconScreenshotRegion v-else aria-hidden="true" /><span><strong>{{ t('shell.pageTools.elementScreenshot') }}</strong><small>{{ t('shell.pageTools.screenshotDescription') }}</small></span>
          </UiButton>
        </div>
      </section>
      <section aria-labelledby="page-tools-audit-title">
        <h3 id="page-tools-audit-title">{{ t('shell.pageTools.audit') }}</h3>
        <div class="page-tools-grid">
          <UiButton native :class="{ complete: qualityAuditState === 'complete' && qualityAuditReport?.status === 'pass', warning: qualityAuditState === 'complete' && qualityAuditReport?.status === 'warning', error: qualityAuditState === 'error' || qualityAuditReport?.status === 'error', running: qualityAuditState === 'running' }" type="button" :aria-label="t('runtime.address.quality', { status: labels.qualityAudit })" :disabled="qualityAuditState === 'running'" @click="toggleQualityAudit">
            <IconProgress v-if="qualityAuditState === 'running'" class="state-spinner" aria-hidden="true" /><IconCheck v-else-if="qualityAuditReport?.status === 'pass'" aria-hidden="true" /><IconError v-else-if="qualityAuditState === 'error' || qualityAuditReport?.status === 'error'" aria-hidden="true" /><IconFactCheck v-else aria-hidden="true" /><span><strong>{{ t('panels.qualityAudit') }}</strong><small>{{ labels.qualityAudit }}</small></span>
          </UiButton>
          <UiButton native :class="{ complete: accessibilityAuditState === 'complete' && accessibilityAudit?.violationCount === 0, warning: accessibilityAuditState === 'complete' && Boolean(accessibilityAudit?.violationCount), error: accessibilityAuditState === 'error', running: accessibilityAuditState === 'running' }" type="button" :aria-label="labels.accessibilityAudit" :disabled="accessibilityAuditState === 'running'" @click="toggleAccessibilityAudit">
            <IconProgress v-if="accessibilityAuditState === 'running'" class="state-spinner" aria-hidden="true" /><IconCheck v-else-if="accessibilityAuditState === 'complete' && accessibilityAudit?.violationCount === 0" aria-hidden="true" /><IconError v-else-if="accessibilityAuditState === 'error'" aria-hidden="true" /><IconAccessibility v-else aria-hidden="true" /><span><strong>{{ t('panels.accessibility') }}</strong><small>{{ labels.accessibilityAudit }}</small></span>
          </UiButton>
          <UiButton native :class="{ error: performanceState === 'error', running: performanceState === 'running' }" type="button" :aria-label="labels.performance" :disabled="performanceState === 'running'" @click="togglePerformanceReport"><IconProgress v-if="performanceState === 'running'" class="state-spinner" aria-hidden="true" /><IconError v-else-if="performanceState === 'error'" aria-hidden="true" /><IconMonitoring v-else aria-hidden="true" /><span><strong>{{ t('panels.performance') }}</strong><small>{{ labels.performance }}</small></span></UiButton>
          <UiButton native :class="{ warning: Boolean(designOverviewReport?.summary.contrastIssueCount), error: designOverviewState === 'error', running: designOverviewState === 'loading' }" type="button" :aria-label="t('designOverview.toolAria', { status: labels.designOverview })" :disabled="designOverviewState === 'loading'" @click="toggleDesignOverview"><IconProgress v-if="designOverviewState === 'loading'" class="state-spinner" aria-hidden="true" /><IconPalette v-else aria-hidden="true" /><span><strong>{{ t('panels.designOverview') }}</strong><small>{{ labels.designOverview }}</small></span></UiButton>
          <UiButton native :class="{ warning: Boolean(pageMetadataReport?.issues.some((issue) => issue.severity !== 'info')), error: pageMetadataState === 'error', running: pageMetadataState === 'loading' }" type="button" :aria-label="t('pageMetadata.toolAria', { status: labels.pageMetadata })" :disabled="pageMetadataState === 'loading'" @click="togglePageMetadata"><IconProgress v-if="pageMetadataState === 'loading'" class="state-spinner" aria-hidden="true" /><IconLanguage v-else aria-hidden="true" /><span><strong>{{ t('panels.pageMetadata') }}</strong><small>{{ labels.pageMetadata }}</small></span></UiButton>
          <UiButton native :class="{ complete: coverageResult?.status === 'complete', error: coverageState === 'error', running: Boolean(activeTab?.codeCoverageRecording) || coverageState === 'loading' }" type="button" :aria-label="t('coverage.toolAria', { status: labels.coverage })" :disabled="coverageState === 'loading'" @click="toggleCodeCoverage"><IconProgress v-if="coverageState === 'loading'" class="state-spinner" aria-hidden="true" /><IconCode v-else aria-hidden="true" /><span><strong>{{ t('panels.coverage') }}</strong><small>{{ labels.coverage }}</small></span></UiButton>
          <UiButton native :class="{ complete: cpuProfileResult?.status === 'complete', error: cpuProfileState === 'error', running: Boolean(activeTab?.cpuProfileRecording) || cpuProfileState === 'loading' }" type="button" :aria-label="t('cpuProfile.toolAria', { status: labels.cpuProfile })" :disabled="cpuProfileState === 'loading'" @click="toggleCpuProfile"><IconProgress v-if="cpuProfileState === 'loading'" class="state-spinner" aria-hidden="true" /><IconMonitoring v-else aria-hidden="true" /><span><strong>{{ t('shell.pageTools.javascriptCpu') }}</strong><small>{{ labels.cpuProfile }}</small></span></UiButton>
          <UiButton native :class="{ error: memoryState === 'error', running: memoryState === 'running' }" type="button" :aria-label="t('memory.toolAria', { status: labels.memory })" :disabled="memoryState === 'running'" @click="toggleMemoryReport"><IconProgress v-if="memoryState === 'running'" class="state-spinner" aria-hidden="true" /><IconError v-else-if="memoryState === 'error'" aria-hidden="true" /><IconMemory v-else aria-hidden="true" /><span><strong>{{ t('panels.memory') }}</strong><small>{{ labels.memory }}</small></span></UiButton>
        </div>
      </section>
      <section aria-labelledby="page-tools-export-title">
        <h3 id="page-tools-export-title">{{ t('shell.pageTools.exportAccount') }}</h3>
        <div class="page-tools-grid">
          <UiButton native :class="{ copied: snapshotState === 'copied', error: snapshotState === 'error', running: snapshotState === 'copying' }" type="button" :aria-label="t('shell.pageTools.copySnapshotAria')" :disabled="snapshotState === 'copying'" @click="actions.copyPageSnapshot">
            <IconProgress v-if="snapshotState === 'copying'" class="state-spinner" aria-hidden="true" /><IconCheck v-else-if="snapshotState === 'copied'" aria-hidden="true" /><IconError v-else-if="snapshotState === 'error'" aria-hidden="true" /><IconAccountTree v-else aria-hidden="true" /><span><strong>{{ t('shell.pageTools.copySnapshot') }}</strong><small>{{ t('shell.pageTools.copySnapshotDescription') }}</small></span>
          </UiButton>
          <UiButton native type="button" :aria-label="labels.pdfExport" :disabled="pdfState === 'saving'" @click="closeAndRun(actions.savePdf)">
            <IconProgress v-if="pdfState === 'saving'" class="state-spinner" aria-hidden="true" /><IconCheck v-else-if="pdfState === 'saved'" aria-hidden="true" /><IconError v-else-if="pdfState === 'error'" aria-hidden="true" /><IconPdf v-else aria-hidden="true" /><span><strong>{{ t('shell.pageTools.savePdf') }}</strong><small>{{ labels.pdfExport }}</small></span>
          </UiButton>
          <UiButton native type="button" :aria-label="credentialCount ? t('shell.pageTools.fillPassword') : t('shell.pageTools.noPassword')" :disabled="!credentialStorageAvailable || !credentialCount" @click="closeAndRun(actions.fillSavedPassword)">
            <IconPassword aria-hidden="true" /><span><strong>{{ t('shell.pageTools.savedPassword') }}</strong><small>{{ credentialCount ? t('shell.pageTools.accountsAvailable', { count: localNumber(credentialCount) }) : t('shell.pageTools.noAccount') }}</small></span>
          </UiButton>
        </div>
      </section>
    </div>
    <footer><span>{{ hostname }}</span><span>{{ t('shell.pageTools.pageActions') }}</span></footer>
  </section>
</template>
