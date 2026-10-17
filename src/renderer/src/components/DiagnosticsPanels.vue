<script setup lang="ts">
import type {
  BrowserTabState,
  PanelDock,
  SupportedLocale
} from '../../../shared/types'
import type { DiagnosticsController } from '../composables/useDiagnosticsController'
import QualityAuditPanel from './QualityAuditPanel.vue'
import AccessibilityAuditPanel from './AccessibilityAuditPanel.vue'
import PerformanceReportPanel from './PerformanceReportPanel.vue'
import DesignOverviewPanel from './DesignOverviewPanel.vue'
import PageMetadataPanel from '../features/diagnostics/page-metadata/PageMetadataPanel.vue'
import SecurityReportPanel from './SecurityReportPanel.vue'
import CodeCoveragePanel from './CodeCoveragePanel.vue'
import CpuProfilePanel from './CpuProfilePanel.vue'
import MemoryReportPanel from './MemoryReportPanel.vue'
import InspectorIssuesPanel from './InspectorIssuesPanel.vue'
import DebugReportPanel from './DebugReportPanel.vue'
import ReproRecordingPanel from './ReproRecordingPanel.vue'
import DomChangesPanel from './DomChangesPanel.vue'
import VisualComparePanel from './VisualComparePanel.vue'

// Each panel renders its own docked section behind the controller's open state.
// Requests, race guards and open-state watchers stay in the shared controller,
// which outlives these panels and also serves Page Tools.
defineProps<{
  activeTab?: BrowserTabState
  locale: SupportedLocale
  controller: DiagnosticsController
  openSupport: (url: string) => Promise<void>
  preservationBusy: boolean
  updatePreservation: (event: Event) => unknown
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
  <CodeCoveragePanel v-model:dock="dock" :controller="controller" :locale="locale" />
  <CpuProfilePanel v-model:dock="dock" :controller="controller" :locale="locale" />
  <MemoryReportPanel v-model:dock="dock" :controller="controller" :locale="locale" />
  <InspectorIssuesPanel v-model:dock="dock" :controller="controller" :locale="locale" />
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
  <VisualComparePanel v-model:dock="dock" :controller="controller" :locale="locale" />
</template>
