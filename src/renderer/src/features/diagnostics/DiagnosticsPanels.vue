<script setup lang="ts">
import type {
  BrowserTabState,
  PanelDock,
  SupportedLocale
} from '../../../../shared/types'
import type { DiagnosticsController } from './useDiagnosticsController'
import QualityAuditPanel from './quality-audit/QualityAuditPanel.vue'
import AccessibilityAuditPanel from './accessibility-audit/AccessibilityAuditPanel.vue'
import PerformanceReportPanel from './performance-report/PerformanceReportPanel.vue'
import DesignOverviewPanel from './design-overview/DesignOverviewPanel.vue'
import PageMetadataPanel from './page-metadata/PageMetadataPanel.vue'
import SecurityReportPanel from './security-report/SecurityReportPanel.vue'
import CodeCoveragePanel from './code-coverage/CodeCoveragePanel.vue'
import CpuProfilePanel from './cpu-profile/CpuProfilePanel.vue'
import MemoryReportPanel from './memory-report/MemoryReportPanel.vue'
import InspectorIssuesPanel from './inspector-issues/InspectorIssuesPanel.vue'
import DebugReportPanel from './debug-report/DebugReportPanel.vue'
import ReproRecordingPanel from './repro-recorder/ReproRecordingPanel.vue'
import DomChangesPanel from './dom-changes/DomChangesPanel.vue'
import VisualComparePanel from './visual-compare/VisualComparePanel.vue'

// Each panel renders its own docked section behind the controller's open state.
// Requests, race guards and open-state watchers stay in the shared controller,
// which outlives these panels and also serves Page Tools. Visual compare,
// Issues, Code coverage and CPU profile also watch their dock, to read the tab
// again when they dock back from their own window; the audits and reports run
// again then only when a page change cleared them meanwhile.
defineProps<{
  activeTab?: BrowserTabState
  locale: SupportedLocale
  controller: DiagnosticsController
  openSupport: (url: string) => Promise<void>
  preservationBusy: boolean
  updatePreservation: (event: Event) => unknown
  keepsSeparatePanelOpen: () => boolean
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
</script>

<template>
  <QualityAuditPanel v-model:dock="dock" :controller="controller" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
  <AccessibilityAuditPanel v-model:dock="dock" :controller="controller" :locale="locale" :open-support="openSupport" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
  <PerformanceReportPanel v-model:dock="dock" :controller="controller" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
  <DesignOverviewPanel v-model:dock="dock" :controller="controller" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
  <PageMetadataPanel v-model:dock="dock" :controller="controller.metadata" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
  <SecurityReportPanel v-model:dock="dock" :controller="controller" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
  <CodeCoveragePanel v-model:dock="dock" :controller="controller" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
  <CpuProfilePanel v-model:dock="dock" :controller="controller" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
  <MemoryReportPanel v-model:dock="dock" :controller="controller" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
  <InspectorIssuesPanel v-model:dock="dock" :controller="controller" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
  <DebugReportPanel
    v-model:dock="dock"
    :active-tab="activeTab"
    :controller="controller"
    :locale="locale"
    :preservation-busy="preservationBusy"
    :update-preservation="updatePreservation"
    :keeps-separate-panel-open="keepsSeparatePanelOpen"
  />
  <ReproRecordingPanel v-model:dock="dock" :controller="controller" :locale="locale" />
  <DomChangesPanel v-model:dock="dock" :controller="controller" :locale="locale" />
  <VisualComparePanel v-model:dock="dock" :controller="controller" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
</template>
