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
// which outlives these panels and also serves Page Tools. A panel that shows a
// recording, comparison or issue list reads it again when it docks back from
// its own window.
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
  <QualityAuditPanel v-model:dock="dock" :controller="controller" :locale="locale" />
  <AccessibilityAuditPanel v-model:dock="dock" :controller="controller" :locale="locale" :open-support="openSupport" />
  <PerformanceReportPanel v-model:dock="dock" :controller="controller" :locale="locale" />
  <DesignOverviewPanel v-model:dock="dock" :controller="controller" :locale="locale" />
  <PageMetadataPanel v-model:dock="dock" :controller="controller.metadata" :locale="locale" />
  <SecurityReportPanel v-model:dock="dock" :controller="controller" :locale="locale" />
  <CodeCoveragePanel v-model:dock="dock" :controller="controller" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
  <CpuProfilePanel v-model:dock="dock" :controller="controller" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
  <MemoryReportPanel v-model:dock="dock" :controller="controller" :locale="locale" />
  <InspectorIssuesPanel v-model:dock="dock" :controller="controller" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
  <DebugReportPanel
    v-model:dock="dock"
    :active-tab="activeTab"
    :controller="controller"
    :locale="locale"
    :preservation-busy="preservationBusy"
    :update-preservation="updatePreservation"
  />
  <ReproRecordingPanel v-model:dock="dock" :controller="controller" :locale="locale" />
  <DomChangesPanel v-model:dock="dock" :controller="controller" :locale="locale" />
  <VisualComparePanel v-model:dock="dock" :controller="controller" :locale="locale" :keeps-separate-panel-open="keepsSeparatePanelOpen" />
</template>
