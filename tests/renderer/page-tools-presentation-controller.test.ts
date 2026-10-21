import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  usePageToolsPresentationController,
  type PageToolsPresentationControllerOptions
} from '../../src/renderer/src/composables/usePageToolsPresentationController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserTabState, SupportedLocale } from '../../src/shared/types.js'

function tab(overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/',
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: true,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false,
    ...overrides
  }
}

function create(locale?: SupportedLocale) {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const activeEmulation = ref<unknown>(undefined)
  const environmentState = ref<'idle' | 'applying' | 'applied' | 'error'>('idle')
  const environmentOverrideCount = ref(0)
  const diagnostics = {
    accessibilityAuditState: ref('idle'),
    accessibilityAudit: ref<unknown>(null),
    qualityAuditState: ref('idle'),
    qualityAuditReport: ref<unknown>(null),
    performanceState: ref('idle'),
    designOverviewState: ref('idle'),
    designOverviewReport: ref<unknown>(null),
    pageMetadataState: ref('idle'),
    pageMetadataReport: ref<unknown>(null),
    securityReportState: ref('idle'),
    securityReport: ref<unknown>(null),
    coverageState: ref('idle'),
    coverageResult: ref<unknown>(null),
    cpuProfileState: ref('idle'),
    cpuProfileResult: ref<unknown>(null),
    memoryState: ref('idle'),
    memoryReport: ref<unknown>(null),
    memoryPanelOpen: ref(false),
    debugReportState: ref('idle'),
    debugReport: ref<unknown>(null),
    reproRecording: ref<unknown>(null),
    domChangesReport: ref<unknown>(null),
    visualCompareState: ref('idle'),
    visualCompareReport: ref<unknown>(null)
  }
  const capture = {
    elementState: ref('idle'),
    elementMode: ref('context'),
    captureState: ref('idle'),
    captureMode: ref('area'),
    captureError: ref('')
  }
  const pageExport = {
    pdfState: ref('idle'),
    pdfExport: ref<unknown>(null)
  }
  const translate = locale
    ? createHronautI18n(locale).global.t as PageToolsPresentationControllerOptions['translate']
    : (key: string, parameters?: Record<string, unknown>): string => {
      const suffix = parameters ? `:${Object.values(parameters).join(',')}` : ''
      return `[${key}${suffix}]`
    }
  const controller = usePageToolsPresentationController({
    activeTab,
    emulation: { activeEmulation } as unknown as PageToolsPresentationControllerOptions['emulation'],
    environmentState,
    environmentOverrideCount,
    diagnostics: diagnostics as unknown as PageToolsPresentationControllerOptions['diagnostics'],
    capture: capture as unknown as PageToolsPresentationControllerOptions['capture'],
    pageExport: pageExport as unknown as PageToolsPresentationControllerOptions['pageExport'],
    translate,
    formatNumber: locale ? (value) => String(value) : (value) => `#${value}`,
    formatPercent: (value, digits = 0) => `${value.toFixed(digits)}%`,
    formatBytes: (value) => `${value} B`
  })
  return {
    controller,
    activeTab,
    activeEmulation,
    environmentState,
    environmentOverrideCount,
    diagnostics,
    capture,
    pageExport
  }
}

describe('page tools presentation controller', () => {
  it('names a connection security state in the interface language', () => {
    const state = create('de-DE')
    state.diagnostics.securityReportState.value = 'complete'
    state.diagnostics.securityReport.value = { state: 'unknown' }

    expect(state.controller.labels.value.security).toBe('Verbindungsstatus: unbekannt')
  })

  it('provides stable default labels for an idle website', () => {
    const { controller } = create()

    expect(controller.labels.value).toMatchObject({
      responsive: '[runtime.responsive.preview]',
      environment: '[runtime.tool.environmentDescription]',
      accessibilityAudit: '[runtime.tool.accessibilityRun]',
      qualityAudit: '[runtime.tool.qualityDescription]',
      performance: '[runtime.tool.performanceRun]',
      contextPicker: '[runtime.capture.selectElement]',
      elementScreenshot: '[runtime.capture.selectScreenshot]',
      pdfExport: '[runtime.pdf.save]'
    })
    expect(controller.elementPickerTitle.value).toContain('Ctrl+Shift+C')
    expect(controller.areaCaptureLabel.value).toBe('[runtime.capture.area]')
  })

  it('reacts to viewport, environment, route, issue, and running states', () => {
    const state = create()
    state.activeEmulation.value = {
      viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true, orientation: 'portrait' }
    }
    state.environmentOverrideCount.value = 2
    state.activeTab.value = tab({ networkRouteCount: 3, inspectorIssueCount: 4 })
    state.diagnostics.accessibilityAuditState.value = 'running'
    state.diagnostics.qualityAuditState.value = 'error'
    state.diagnostics.performanceState.value = 'complete'
    state.diagnostics.designOverviewState.value = 'loading'
    state.diagnostics.pageMetadataState.value = 'error'
    state.diagnostics.securityReportState.value = 'loading'
    state.diagnostics.coverageState.value = 'error'
    state.diagnostics.cpuProfileState.value = 'loading'
    state.diagnostics.memoryState.value = 'running'
    state.diagnostics.debugReportState.value = 'running'
    state.diagnostics.visualCompareState.value = 'error'

    expect(state.controller.labels.value).toMatchObject({
      responsive: '[runtime.responsive.at:390×844,#3]',
      environment: '[environment.activeConditions:#2]',
      accessibilityAudit: '[runtime.tool.accessibilityRunning]',
      qualityAudit: '[runtime.tool.qualityAttention]',
      performance: '[runtime.tool.performanceView]',
      designOverview: '[designOverview.toolCapturing]',
      pageMetadata: '[pageMetadata.toolAttention]',
      security: '[securityReport.toolInspecting]',
      coverage: '[coverage.toolAttention]',
      cpuProfile: '[cpuProfile.toolLoading]',
      memory: '[memory.toolMeasuring]',
      debugReport: '[debugReport.toolCollecting]',
      visualCompare: '[visualCompare.toolAttention]',
      inspectorIssues: '[issues.toolCount:#4]'
    })
    expect(state.controller.activeNetworkRouteCount.value).toBe(3)
    expect(state.controller.activeInspectorIssueCount.value).toBe(4)
  })

  it('summarizes completed reports and active recorders', () => {
    const state = create()
    state.activeTab.value = tab({
      codeCoverageRecording: { startedAt: '', mode: 'block' },
      cpuProfileRecording: { startedAt: '' },
      memoryAllocationRecording: { startedAt: '' },
      reproRecording: { active: true, stepCount: 5, startedAt: '' },
      domChangesRecording: { active: true, changeCount: 7, startedAt: '' }
    })
    state.diagnostics.accessibilityAuditState.value = 'complete'
    state.diagnostics.accessibilityAudit.value = { violationCount: 2 }
    state.diagnostics.qualityAuditReport.value = { status: 'warning', totals: { errors: 1, warnings: 3 } }
    state.diagnostics.designOverviewReport.value = { summary: { contrastIssueCount: 2 } }
    state.diagnostics.pageMetadataReport.value = { issues: [{ severity: 'warning' }, { severity: 'info' }] }
    state.diagnostics.securityReport.value = { state: 'secure' }
    state.diagnostics.debugReportState.value = 'complete'
    state.diagnostics.debugReport.value = { summary: { consoleErrors: 1, consoleWarnings: 2, failedRequests: 3 } }
    state.diagnostics.visualCompareReport.value = { status: 'compared', identical: false, changedPercent: 1.25 }

    expect(state.controller.labels.value).toMatchObject({
      accessibilityAudit: '[runtime.tool.accessibilityResult:#2]',
      qualityAudit: '[runtime.tool.qualityResult:[runtime.tool.qualityErrors:#1],[runtime.tool.qualityWarnings:#3]]',
      designOverview: '[designOverview.toolIssueCount:#2]',
      pageMetadata: '[pageMetadata.toolWarningCount:#1]',
      security: '[securityReport.toolSecure]',
      coverage: '[coverage.toolRecording:block]',
      cpuProfile: '[cpuProfile.toolRecording]',
      memory: '[memory.toolSampling]',
      debugReport: '[debugReport.toolSignals:#6]',
      repro: '[repro.toolRecording:[repro.stepCount:#5]]',
      domChanges: '[domChanges.toolRecording:[domChanges.mutations:#7]]',
      visualCompare: '[visualCompare.toolChanged:1.25%]'
    })
    expect(state.controller.debugReportSignalCount.value).toBe(6)
  })

  it('presents picker, capture, and PDF feedback without stale fallback text', () => {
    const state = create()
    state.capture.elementMode.value = 'screenshot'
    state.capture.elementState.value = 'copied'
    state.capture.captureState.value = 'capturing'
    state.capture.captureMode.value = 'full-page'
    state.pageExport.pdfState.value = 'saved'
    state.pageExport.pdfExport.value = { path: '/tmp/page.pdf' }

    expect(state.controller.labels.value.contextPicker).toBe('[runtime.capture.selectElement]')
    expect(state.controller.labels.value.elementScreenshot).toBe('[runtime.capture.elementScreenshotCopied]')
    expect(state.controller.elementPickerTitle.value).toBe('[runtime.capture.elementScreenshotCopied]')
    expect(state.controller.areaCaptureLabel.value).toBe('[runtime.capture.capturingFull]')
    expect(state.controller.labels.value.pdfExport).toBe('[runtime.pdf.saved:/tmp/page.pdf]')

    state.capture.captureState.value = 'error'
    state.capture.captureError.value = 'Selection disappeared'
    state.pageExport.pdfExport.value = null
    expect(state.controller.areaCaptureLabel.value).toBe('Selection disappeared')
    expect(state.controller.labels.value.pdfExport).toBe('[runtime.pdf.saved:[runtime.pdf.directory]]')
  })

  it('gives each count the word form its own number takes', () => {
    // One plural form was picked for both counts, by the larger one ("1 errors · 3 warnings"), and the active
    // conditions took English's one-or-many choice ("2 активных условий").
    const english = create('en-US')
    english.diagnostics.qualityAuditReport.value = { status: 'warning', totals: { errors: 1, warnings: 3 } }
    expect(english.controller.labels.value.qualityAudit).toBe('1 error · 3 warnings')

    const ukrainian = create('uk-UA')
    ukrainian.diagnostics.qualityAuditReport.value = { status: 'warning', totals: { errors: 2, warnings: 5 } }
    expect(ukrainian.controller.labels.value.qualityAudit).toBe('2 помилки · 5 попереджень')

    const russian = create('ru-RU')
    russian.environmentOverrideCount.value = 2
    expect(russian.controller.labels.value.environment).toBe('2 активных условия')
    russian.environmentOverrideCount.value = 21
    expect(russian.controller.labels.value.environment).toBe('21 активное условие')
  })
})
