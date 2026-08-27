import type { Ref } from 'vue'
import type { BrowserTabState } from '../../../shared/types.js'
import { friendlyUiError, type AppToastTone } from './useAppToastController.js'
import {
  useDiagnosticsController,
  type DiagnosticsControllerOptions
} from './useDiagnosticsController.js'
import {
  usePageCaptureController,
  type PageCaptureControllerOptions
} from './usePageCaptureController.js'
import {
  usePageExportController,
  type PageExportControllerOptions
} from './usePageExportController.js'
import {
  usePageToolsPresentationController,
  type PageToolsPresentationControllerOptions
} from './usePageToolsPresentationController.js'

export interface AppPageToolsFeatureControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: PageCaptureControllerOptions['browser']
    & PageExportControllerOptions['browser']
    & DiagnosticsControllerOptions['browser']
  emulation: PageToolsPresentationControllerOptions['emulation']
  environmentState: PageToolsPresentationControllerOptions['environmentState']
  environmentOverrideCount: PageToolsPresentationControllerOptions['environmentOverrideCount']
  copyText: DiagnosticsControllerOptions['copyText']
  closeTransientPanels: DiagnosticsControllerOptions['closeTransientPanels']
  keepsSeparatePanelOpen: DiagnosticsControllerOptions['keepsSeparatePanelOpen']
  translate: PageToolsPresentationControllerOptions['translate']
  formatNumber: PageToolsPresentationControllerOptions['formatNumber']
  formatPercent: PageToolsPresentationControllerOptions['formatPercent']
  formatBytes: PageToolsPresentationControllerOptions['formatBytes']
  showToast: (tone: AppToastTone, title: string, message: string) => void
}

export function useAppPageToolsFeatureController(options: AppPageToolsFeatureControllerOptions) {
  const pageCaptureController = usePageCaptureController({
    activeTab: options.activeTab,
    browser: options.browser,
    onElementCopied: (mode) => options.showToast(
      'success',
      options.translate(mode === 'screenshot' ? 'runtime.toast.elementScreenshotCopied' : 'runtime.toast.elementCopied'),
      options.translate(mode === 'screenshot' ? 'runtime.capture.pastePng' : 'runtime.capture.safeContext')
    ),
    onElementFailed: (mode, error) => options.showToast(
      'error',
      options.translate(mode === 'screenshot' ? 'runtime.toast.elementScreenshotFailed' : 'runtime.toast.elementFailed'),
      friendlyUiError(
        error,
        options.translate(mode === 'screenshot'
          ? 'runtime.toast.elementScreenshotDescription'
          : 'runtime.toast.elementDescription')
      )
    ),
    onCaptureCopied: (mode) => options.showToast(
      'success',
      options.translate(mode === 'area'
        ? 'runtime.toast.areaCopied'
        : mode === 'full-page'
          ? 'runtime.toast.fullCopied'
          : 'runtime.toast.viewportCopied'),
      options.translate('runtime.capture.pastePng')
    ),
    onCaptureFailed: (mode, error) => {
      const captureName = mode === 'area'
        ? ''
        : options.translate(mode === 'full-page'
          ? 'runtimeActions.capture.fullPage'
          : 'runtimeActions.capture.viewport')
      const message = friendlyUiError(
        error,
        mode === 'area'
          ? options.translate('runtimeActions.capture.areaFallback')
          : options.translate('runtimeActions.capture.pageFallback', { area: captureName })
      )
      options.showToast('error', options.translate('runtime.capture.screenshotFailed'), message)
      return mode === 'area'
        ? options.translate('runtimeActions.capture.areaCopyFailed', { error: message })
        : options.translate('runtimeActions.capture.pageCopyFailed', { area: captureName, error: message })
    }
  })
  const pageExportController = usePageExportController({
    activeTab: options.activeTab,
    browser: options.browser,
    snapshotCopied: (result) => options.showToast(
      'success',
      options.translate('runtimeActions.pageSnapshot.copied'),
      options.translate('runtimeActions.pageSnapshot.ready', {
        count: options.formatNumber(result.characters),
        limit: options.translate(result.truncated
          ? 'runtimeActions.pageSnapshot.bounded'
          : 'runtimeActions.pageSnapshot.period')
      })
    ),
    snapshotFailed: (error) => options.showToast(
      'error',
      options.translate('runtime.toast.pageSnapshotFailed'),
      friendlyUiError(error, options.translate('runtime.toast.pageSnapshotDescription'))
    ),
    pdfSaved: (result) => options.showToast(
      'success',
      options.translate('shell.pageTools.savePdf'),
      options.translate('runtime.pdf.saved', { path: result.path })
    ),
    pdfFailed: (error) => options.showToast(
      'error',
      options.translate('runtime.pdf.failed'),
      friendlyUiError(error, options.translate('runtime.pdf.failed'))
    )
  })
  const diagnosticsController = useDiagnosticsController({
    activeTab: options.activeTab,
    browser: options.browser,
    translate: (message, parameters) => options.translate(message, parameters ?? {}),
    copyText: options.copyText,
    closeTransientPanels: options.closeTransientPanels,
    keepsSeparatePanelOpen: options.keepsSeparatePanelOpen
  })
  const pageToolsPresentationController = usePageToolsPresentationController({
    activeTab: options.activeTab,
    emulation: options.emulation,
    environmentState: options.environmentState,
    environmentOverrideCount: options.environmentOverrideCount,
    diagnostics: diagnosticsController,
    capture: pageCaptureController,
    pageExport: pageExportController,
    translate: options.translate,
    formatNumber: options.formatNumber,
    formatPercent: options.formatPercent,
    formatBytes: options.formatBytes
  })
  let captureAndExportDisposed = false
  let diagnosticsDisposed = false

  function disposeCaptureAndExport(): void {
    if (captureAndExportDisposed) return
    captureAndExportDisposed = true
    pageCaptureController.dispose()
    pageExportController.dispose()
  }

  function disposeDiagnostics(): void {
    if (diagnosticsDisposed) return
    diagnosticsDisposed = true
    diagnosticsController.dispose()
  }

  function dispose(): void {
    disposeCaptureAndExport()
    disposeDiagnostics()
  }

  return {
    pageCaptureController,
    pageExportController,
    diagnosticsController,
    pageToolsPresentationController,
    elementPickerState: pageCaptureController.elementState,
    elementPickerMode: pageCaptureController.elementMode,
    areaCaptureState: pageCaptureController.captureState,
    toggleElementPicker: pageCaptureController.toggleElementPicker,
    cancelActiveElementPicker: pageCaptureController.cancelElementPicker,
    toggleAreaCapture: pageCaptureController.toggleAreaCapture,
    capturePageScreenshot: pageCaptureController.capturePage,
    pageSnapshotState: pageExportController.snapshotState,
    pdfExportState: pageExportController.pdfState,
    copyPageSnapshot: pageExportController.copySnapshot,
    saveActivePdf: pageExportController.savePdf,
    accessibilityPanelOpen: diagnosticsController.accessibilityPanelOpen,
    qualityAuditPanelOpen: diagnosticsController.qualityAuditPanelOpen,
    performancePanelOpen: diagnosticsController.performancePanelOpen,
    designOverviewPanelOpen: diagnosticsController.designOverviewPanelOpen,
    pageMetadataPanelOpen: diagnosticsController.pageMetadataPanelOpen,
    securityPanelOpen: diagnosticsController.securityPanelOpen,
    coveragePanelOpen: diagnosticsController.coveragePanelOpen,
    cpuProfilePanelOpen: diagnosticsController.cpuProfilePanelOpen,
    memoryPanelOpen: diagnosticsController.memoryPanelOpen,
    debugReportPanelOpen: diagnosticsController.debugReportPanelOpen,
    reproPanelOpen: diagnosticsController.reproPanelOpen,
    domChangesPanelOpen: diagnosticsController.domChangesPanelOpen,
    visualComparePanelOpen: diagnosticsController.visualComparePanelOpen,
    inspectorIssuesOpen: diagnosticsController.inspectorIssuesOpen,
    togglePerformanceReport: diagnosticsController.togglePerformanceReport,
    toggleDesignOverview: diagnosticsController.toggleDesignOverview,
    togglePageMetadata: diagnosticsController.togglePageMetadata,
    toggleSecurityReport: diagnosticsController.toggleSecurityReport,
    toggleCodeCoverage: diagnosticsController.toggleCodeCoverage,
    toggleCpuProfile: diagnosticsController.toggleCpuProfile,
    toggleMemoryReport: diagnosticsController.toggleMemoryReport,
    toggleDebugReport: diagnosticsController.toggleDebugReport,
    toggleReproRecorder: diagnosticsController.toggleReproRecorder,
    toggleDomChanges: diagnosticsController.toggleDomChanges,
    toggleVisualCompare: diagnosticsController.toggleVisualCompare,
    toggleInspectorIssues: diagnosticsController.toggleInspectorIssues,
    toggleAccessibilityAudit: diagnosticsController.toggleAccessibilityAudit,
    toggleQualityAudit: diagnosticsController.toggleQualityAudit,
    pageToolsLabels: pageToolsPresentationController.labels,
    activeNetworkRouteCount: pageToolsPresentationController.activeNetworkRouteCount,
    activeInspectorIssueCount: pageToolsPresentationController.activeInspectorIssueCount,
    debugReportSignalCount: pageToolsPresentationController.debugReportSignalCount,
    elementPickerLabel: pageToolsPresentationController.elementPickerLabel,
    elementPickerTitle: pageToolsPresentationController.elementPickerTitle,
    areaCaptureLabel: pageToolsPresentationController.areaCaptureLabel,
    disposeCaptureAndExport,
    disposeDiagnostics,
    dispose
  }
}

export type AppPageToolsFeatureController = ReturnType<typeof useAppPageToolsFeatureController>
