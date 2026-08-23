import { computed, type Ref } from 'vue'
import type { BrowserTabState } from '../../../shared/types.js'
import type { DiagnosticsController } from './useDiagnosticsController.js'
import type { EmulationController } from './useEmulationController.js'
import type { EnvironmentPanelState } from './useEnvironmentPanelController.js'
import type { PageCaptureController } from './usePageCaptureController.js'
import type { PageExportController } from './usePageExportController.js'

type Translate = (key: string, parameters?: Record<string, unknown>, plural?: number) => string

type PresentationDiagnostics = Pick<DiagnosticsController,
  | 'accessibilityAuditState'
  | 'accessibilityAudit'
  | 'qualityAuditState'
  | 'qualityAuditReport'
  | 'performanceState'
  | 'designOverviewState'
  | 'designOverviewReport'
  | 'pageMetadataState'
  | 'pageMetadataReport'
  | 'securityReportState'
  | 'securityReport'
  | 'coverageState'
  | 'coverageResult'
  | 'cpuProfileState'
  | 'cpuProfileResult'
  | 'memoryState'
  | 'memoryReport'
  | 'memoryPanelOpen'
  | 'debugReportState'
  | 'debugReport'
  | 'reproRecording'
  | 'domChangesReport'
  | 'visualCompareState'
  | 'visualCompareReport'
>

export interface PageToolsLabels {
  responsive: string
  environment: string
  inspectorIssues: string
  security: string
  debugReport: string
  repro: string
  domChanges: string
  visualCompare: string
  contextPicker: string
  elementScreenshot: string
  qualityAudit: string
  accessibilityAudit: string
  performance: string
  designOverview: string
  pageMetadata: string
  coverage: string
  cpuProfile: string
  memory: string
  pdfExport: string
}

export interface PageToolsPresentationControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  emulation: Pick<EmulationController, 'activeEmulation'>
  environmentState: Readonly<Ref<EnvironmentPanelState>>
  environmentOverrideCount: Readonly<Ref<number>>
  diagnostics: PresentationDiagnostics
  capture: Pick<PageCaptureController, 'elementState' | 'elementMode' | 'captureState' | 'captureMode' | 'captureError'>
  pageExport: Pick<PageExportController, 'pdfState' | 'pdfExport'>
  translate: Translate
  formatNumber: (value: number) => string
  formatPercent: (value: number, maximumFractionDigits?: number) => string
  formatBytes: (value: number) => string
}

export function usePageToolsPresentationController(options: PageToolsPresentationControllerOptions) {
  const { diagnostics, capture, pageExport } = options
  const responsivePreviewLabel = computed(() => {
    const viewport = options.emulation.activeEmulation.value?.viewport
    return viewport
      ? options.translate('runtime.responsive.at', {
        size: `${viewport.width}×${viewport.height}`,
        scale: options.formatNumber(viewport.deviceScaleFactor)
      })
      : options.translate('runtime.responsive.preview')
  })
  const environmentLabel = computed(() => {
    if (options.environmentState.value === 'applying') return options.translate('runtime.tool.environmentApplying')
    if (options.environmentState.value === 'error') return options.translate('runtime.tool.environmentAttention')
    const count = options.environmentOverrideCount.value
    if (count) {
      return options.translate(
        count === 1 ? 'environment.activeCondition' : 'environment.activeConditions',
        { count: options.formatNumber(count) }
      )
    }
    return options.translate('runtime.tool.environmentDescription')
  })
  const activeNetworkRouteCount = computed(() => options.activeTab.value?.networkRouteCount ?? 0)
  const accessibilityAuditLabel = computed(() => {
    if (diagnostics.accessibilityAuditState.value === 'running') return options.translate('runtime.tool.accessibilityRunning')
    if (diagnostics.accessibilityAuditState.value === 'error') return options.translate('runtime.tool.accessibilityAttention')
    if (diagnostics.accessibilityAuditState.value === 'complete' && diagnostics.accessibilityAudit.value) {
      const count = diagnostics.accessibilityAudit.value.violationCount
      return options.translate('runtime.tool.accessibilityResult', { count: options.formatNumber(count) }, count)
    }
    return options.translate('runtime.tool.accessibilityRun')
  })
  const qualityAuditLabel = computed(() => {
    if (diagnostics.qualityAuditState.value === 'running') return options.translate('runtime.tool.qualityRunning')
    if (diagnostics.qualityAuditState.value === 'error') return options.translate('runtime.tool.qualityAttention')
    const report = diagnostics.qualityAuditReport.value
    if (report) {
      if (report.status === 'pass') return options.translate('runtime.tool.qualityClear')
      const { errors, warnings } = report.totals
      return options.translate(
        'runtime.tool.qualityResult',
        { errors: options.formatNumber(errors), warnings: options.formatNumber(warnings) },
        Math.max(errors, warnings)
      )
    }
    return options.translate('runtime.tool.qualityDescription')
  })
  const performanceLabel = computed(() => {
    if (diagnostics.performanceState.value === 'running') return options.translate('runtime.tool.performanceRunning')
    if (diagnostics.performanceState.value === 'error') return options.translate('runtime.tool.performanceAttention')
    if (diagnostics.performanceState.value === 'complete') return options.translate('runtime.tool.performanceView')
    return options.translate('runtime.tool.performanceRun')
  })
  const designOverviewLabel = computed(() => {
    if (diagnostics.designOverviewState.value === 'loading') return options.translate('designOverview.toolCapturing')
    if (diagnostics.designOverviewState.value === 'error') return options.translate('designOverview.toolAttention')
    const report = diagnostics.designOverviewReport.value
    if (report) {
      const issues = report.summary.contrastIssueCount
      return issues
        ? options.translate('designOverview.toolIssueCount', { count: options.formatNumber(issues) }, issues)
        : options.translate('designOverview.toolReady')
    }
    return options.translate('designOverview.toolDescription')
  })
  const pageMetadataLabel = computed(() => {
    if (diagnostics.pageMetadataState.value === 'loading') return options.translate('pageMetadata.toolInspecting')
    if (diagnostics.pageMetadataState.value === 'error') return options.translate('pageMetadata.toolAttention')
    const report = diagnostics.pageMetadataReport.value
    if (report) {
      const actionable = report.issues.filter((issue) => issue.severity !== 'info').length
      return actionable
        ? options.translate('pageMetadata.toolWarningCount', { count: options.formatNumber(actionable) }, actionable)
        : options.translate('pageMetadata.toolReady')
    }
    return options.translate('pageMetadata.toolDescription')
  })
  const securityLabel = computed(() => {
    if (diagnostics.securityReportState.value === 'loading') return options.translate('securityReport.toolInspecting')
    if (diagnostics.securityReportState.value === 'error') return options.translate('securityReport.toolAttention')
    const report = diagnostics.securityReport.value
    if (report?.state === 'secure') return options.translate('securityReport.toolSecure')
    if (report?.state === 'insecure' || report?.state === 'insecure-broken') return options.translate('securityReport.toolInsecure')
    if (report) return options.translate('securityReport.toolState', { state: report.state })
    return options.translate('securityReport.toolDescription')
  })
  const coverageLabel = computed(() => {
    if (diagnostics.coverageState.value === 'loading') return options.translate('coverage.toolLoading')
    if (diagnostics.coverageState.value === 'error') return options.translate('coverage.toolAttention')
    if (options.activeTab.value?.codeCoverageRecording) {
      return options.translate('coverage.toolRecording', { mode: options.activeTab.value.codeCoverageRecording.mode })
    }
    if (diagnostics.coverageResult.value?.status === 'complete') {
      return options.translate('coverage.toolComplete', {
        percent: options.formatPercent(diagnostics.coverageResult.value.report?.usedPercent ?? 0)
      })
    }
    return options.translate('coverage.toolDescription')
  })
  const cpuProfileLabel = computed(() => {
    if (diagnostics.cpuProfileState.value === 'loading') return options.translate('cpuProfile.toolLoading')
    if (diagnostics.cpuProfileState.value === 'error') return options.translate('cpuProfile.toolAttention')
    if (options.activeTab.value?.cpuProfileRecording) return options.translate('cpuProfile.toolRecording')
    if (diagnostics.cpuProfileResult.value?.status === 'complete') {
      const hotspot = diagnostics.cpuProfileResult.value.report?.hotspots[0]
      return hotspot
        ? options.translate('cpuProfile.toolHotspot', {
          function: hotspot.functionName,
          percent: options.formatPercent(hotspot.selfPercent)
        })
        : options.translate('cpuProfile.toolComplete')
    }
    return options.translate('cpuProfile.toolDescription')
  })
  const memoryLabel = computed(() => {
    if (diagnostics.memoryState.value === 'running') return options.translate('memory.toolMeasuring')
    if (diagnostics.memoryState.value === 'error') return options.translate('memory.toolAttention')
    if (options.activeTab.value?.memoryAllocationRecording) return options.translate('memory.toolSampling')
    if (diagnostics.memoryReport.value?.allocationProfile) {
      const hotspot = diagnostics.memoryReport.value.allocationProfile.hotspots[0]
      return hotspot
        ? options.translate('memory.toolHotspot', {
          function: hotspot.functionName || options.translate('memory.allocation.anonymous'),
          bytes: options.formatBytes(hotspot.selfBytes)
        })
        : options.translate('memory.toolAllocationComplete')
    }
    if (diagnostics.memoryPanelOpen.value) return options.translate('memory.toolClose')
    return options.translate('memory.toolDescription')
  })
  const debugReportSignalCount = computed(() => diagnostics.debugReport.value
    ? diagnostics.debugReport.value.summary.consoleErrors
      + diagnostics.debugReport.value.summary.consoleWarnings
      + diagnostics.debugReport.value.summary.failedRequests
    : 0)
  const debugReportLabel = computed(() => {
    if (diagnostics.debugReportState.value === 'running') return options.translate('debugReport.toolCollecting')
    if (diagnostics.debugReportState.value === 'error') return options.translate('debugReport.toolAttention')
    if (diagnostics.debugReportState.value === 'complete' && diagnostics.debugReport.value) {
      return debugReportSignalCount.value
        ? options.translate('debugReport.toolSignals', { count: options.formatNumber(debugReportSignalCount.value) }, debugReportSignalCount.value)
        : options.translate('debugReport.toolClear')
    }
    return options.translate('debugReport.toolDescription')
  })
  const reproLabel = computed(() => {
    const recording = options.activeTab.value?.reproRecording
    if (recording?.active) {
      return options.translate('repro.toolRecording', {
        steps: options.translate('repro.stepCount', { count: options.formatNumber(recording.stepCount) }, recording.stepCount)
      })
    }
    if (diagnostics.reproRecording.value?.stepCount) {
      const count = diagnostics.reproRecording.value.stepCount
      return options.translate('repro.toolReady', {
        steps: options.translate('repro.stepCount', { count: options.formatNumber(count) }, count)
      })
    }
    return options.translate('repro.toolDescription')
  })
  const domChangesLabel = computed(() => {
    const recording = options.activeTab.value?.domChangesRecording
    if (recording?.active) {
      return options.translate('domChanges.toolRecording', {
        changes: options.translate('domChanges.mutations', { count: options.formatNumber(recording.changeCount) }, recording.changeCount)
      })
    }
    if (diagnostics.domChangesReport.value?.changeCount) {
      const count = diagnostics.domChangesReport.value.changeCount
      return options.translate('domChanges.toolReady', {
        changes: options.translate('domChanges.mutations', { count: options.formatNumber(count) }, count)
      })
    }
    return options.translate('domChanges.toolDescription')
  })
  const visualCompareLabel = computed(() => {
    if (diagnostics.visualCompareState.value === 'loading') return options.translate('visualCompare.toolCapturing')
    if (diagnostics.visualCompareState.value === 'error') return options.translate('visualCompare.toolAttention')
    if (diagnostics.visualCompareReport.value?.status === 'compared') {
      return diagnostics.visualCompareReport.value.identical
        ? options.translate('visualCompare.toolIdentical')
        : options.translate('visualCompare.toolChanged', {
          percent: options.formatPercent(diagnostics.visualCompareReport.value.changedPercent ?? 0, 2)
        })
    }
    if (diagnostics.visualCompareReport.value?.status === 'baseline') return options.translate('visualCompare.toolBaseline')
    return options.translate('visualCompare.toolDescription')
  })
  const activeInspectorIssueCount = computed(() => options.activeTab.value?.inspectorIssueCount ?? 0)
  const inspectorIssuesLabel = computed(() => activeInspectorIssueCount.value
    ? options.translate(
      'issues.toolCount',
      { count: options.formatNumber(activeInspectorIssueCount.value) },
      activeInspectorIssueCount.value
    )
    : options.translate('issues.toolDescription'))
  const elementPickerLabel = computed(() => {
    if (capture.elementState.value === 'picking') {
      return capture.elementMode.value === 'screenshot'
        ? options.translate('runtime.capture.cancelElementScreenshot')
        : options.translate('runtime.capture.cancelElement')
    }
    if (capture.elementState.value === 'copied') {
      return capture.elementMode.value === 'screenshot'
        ? options.translate('runtime.capture.elementScreenshotCopied')
        : options.translate('runtime.capture.elementCopied')
    }
    if (capture.elementState.value === 'error') {
      return capture.elementMode.value === 'screenshot'
        ? options.translate('runtime.capture.elementScreenshotFailed')
        : options.translate('runtime.capture.elementFailed')
    }
    return options.translate('runtime.capture.selectElement')
  })
  const contextPickerLabel = computed(() => capture.elementMode.value === 'context'
    ? elementPickerLabel.value
    : options.translate('runtime.capture.selectElement'))
  const elementScreenshotLabel = computed(() => capture.elementMode.value === 'screenshot'
    ? elementPickerLabel.value
    : options.translate('runtime.capture.selectScreenshot'))
  const elementPickerTitle = computed(() => capture.elementState.value === 'idle'
    ? `${elementPickerLabel.value} (Ctrl+Shift+C / Cmd+Option+C)`
    : elementPickerLabel.value)
  const areaCaptureLabel = computed(() => {
    if (capture.captureState.value === 'picking') return options.translate('runtime.capture.cancelArea')
    if (capture.captureState.value === 'capturing') {
      return options.translate(capture.captureMode.value === 'full-page'
        ? 'runtime.capture.capturingFull'
        : 'runtime.capture.capturingViewport')
    }
    if (capture.captureState.value === 'copied') {
      if (capture.captureMode.value === 'viewport') return options.translate('runtime.capture.viewportCopied')
      if (capture.captureMode.value === 'full-page') return options.translate('runtime.capture.fullCopied')
      return options.translate('runtime.capture.areaCopied')
    }
    if (capture.captureState.value === 'error') return capture.captureError.value || options.translate('runtime.capture.failed')
    return options.translate('runtime.capture.area')
  })
  const pdfExportLabel = computed(() => {
    if (pageExport.pdfState.value === 'saving') return options.translate('runtime.pdf.saving')
    if (pageExport.pdfState.value === 'saved') {
      return options.translate('runtime.pdf.saved', {
        path: pageExport.pdfExport.value?.path ?? options.translate('runtime.pdf.directory')
      })
    }
    if (pageExport.pdfState.value === 'error') return options.translate('runtime.pdf.failed')
    return options.translate('runtime.pdf.save')
  })
  const labels = computed<PageToolsLabels>(() => ({
    responsive: responsivePreviewLabel.value,
    environment: environmentLabel.value,
    inspectorIssues: inspectorIssuesLabel.value,
    security: securityLabel.value,
    debugReport: debugReportLabel.value,
    repro: reproLabel.value,
    domChanges: domChangesLabel.value,
    visualCompare: visualCompareLabel.value,
    contextPicker: contextPickerLabel.value,
    elementScreenshot: elementScreenshotLabel.value,
    qualityAudit: qualityAuditLabel.value,
    accessibilityAudit: accessibilityAuditLabel.value,
    performance: performanceLabel.value,
    designOverview: designOverviewLabel.value,
    pageMetadata: pageMetadataLabel.value,
    coverage: coverageLabel.value,
    cpuProfile: cpuProfileLabel.value,
    memory: memoryLabel.value,
    pdfExport: pdfExportLabel.value
  }))

  return {
    labels,
    activeNetworkRouteCount,
    activeInspectorIssueCount,
    debugReportSignalCount,
    elementPickerLabel,
    elementPickerTitle,
    areaCaptureLabel
  }
}

export type PageToolsPresentationController = ReturnType<typeof usePageToolsPresentationController>
