import { ref, watch, type Ref } from 'vue'
import { formatReproAsPlaywright } from '../../../shared/repro-export.js'
import type {
  BrowserAccessibilityAudit,
  BrowserCodeCoverageMode,
  BrowserCodeCoverageResult,
  BrowserDebugReport,
  BrowserDesignOverviewReport,
  BrowserDomChangesReport,
  BrowserInspectorIssuesReport,
  BrowserMemoryReport,
  BrowserPageMetadataReport,
  BrowserPerformanceAction,
  BrowserPerformanceReport,
  BrowserQualityAudit,
  BrowserReproRecording,
  BrowserSecurityReport,
  BrowserTabState,
  BrowserVisualCompareView,
  BrowserCpuProfileResult,
  HronautApi
} from '../../../shared/types.js'

type DiagnosticsBrowserApi = Pick<
  HronautApi,
  | 'measurePerformance'
  | 'inspectDesign'
  | 'inspectPageMetadata'
  | 'inspectSecurity'
  | 'manageCodeCoverage'
  | 'manageCpuProfile'
  | 'measureMemory'
  | 'createDebugReport'
  | 'manageRepro'
  | 'manageDomChanges'
  | 'visualCompare'
  | 'copyVisualDiff'
  | 'listInspectorIssues'
  | 'runAccessibilityAudit'
  | 'runQualityAudit'
>

type Translate = (key: string, parameters?: Record<string, string | number>) => string
type Domain =
  | 'accessibility'
  | 'quality'
  | 'performance'
  | 'design'
  | 'metadata'
  | 'security'
  | 'coverage'
  | 'cpu'
  | 'memory'
  | 'debug'
  | 'repro'
  | 'dom'
  | 'visual'
  | 'issues'
type CopyFeedback = 'debug' | 'repro' | 'repro-playwright' | 'dom' | 'visual' | 'issues' | 'quality'

export interface DiagnosticsControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: DiagnosticsBrowserApi
  translate: Translate
  copyText: (text: string) => Promise<boolean>
  closeTransientPanels: () => void
  keepsSeparatePanelOpen: () => boolean
}

export function useDiagnosticsController(options: DiagnosticsControllerOptions) {
  const accessibilityAuditState = ref<'idle' | 'running' | 'complete' | 'error'>('idle')
  const accessibilityAudit = ref<BrowserAccessibilityAudit | null>(null)
  const accessibilityAuditError = ref('')
  const accessibilityPanelOpen = ref(false)
  const qualityAuditState = ref<'idle' | 'running' | 'complete' | 'error'>('idle')
  const qualityAuditReport = ref<BrowserQualityAudit | null>(null)
  const qualityAuditError = ref('')
  const qualityAuditPanelOpen = ref(false)
  const qualityAuditCopied = ref(false)
  const performanceState = ref<'idle' | 'running' | 'complete' | 'error'>('idle')
  const performanceReport = ref<BrowserPerformanceReport | null>(null)
  const performanceError = ref('')
  const performancePanelOpen = ref(false)
  const designOverviewPanelOpen = ref(false)
  const designOverviewReport = ref<BrowserDesignOverviewReport | null>(null)
  const designOverviewState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const designOverviewError = ref('')
  const pageMetadataPanelOpen = ref(false)
  const pageMetadataReport = ref<BrowserPageMetadataReport | null>(null)
  const pageMetadataState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const pageMetadataError = ref('')
  const securityPanelOpen = ref(false)
  const securityReport = ref<BrowserSecurityReport | null>(null)
  const securityReportState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const securityReportError = ref('')
  const coveragePanelOpen = ref(false)
  const coverageResult = ref<BrowserCodeCoverageResult | null>(null)
  const coverageState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const coverageError = ref('')
  const coverageMode = ref<BrowserCodeCoverageMode>('function')
  const cpuProfilePanelOpen = ref(false)
  const cpuProfileResult = ref<BrowserCpuProfileResult | null>(null)
  const cpuProfileState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const cpuProfileError = ref('')
  const memoryState = ref<'idle' | 'running' | 'complete' | 'error'>('idle')
  const memoryReport = ref<BrowserMemoryReport | null>(null)
  const memoryError = ref('')
  const memoryPanelOpen = ref(false)
  const debugReportState = ref<'idle' | 'running' | 'complete' | 'error'>('idle')
  const debugReport = ref<BrowserDebugReport | null>(null)
  const debugReportError = ref('')
  const debugReportPanelOpen = ref(false)
  const debugReportCopied = ref(false)
  const reproPanelOpen = ref(false)
  const reproRecording = ref<BrowserReproRecording | null>(null)
  const reproState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const reproError = ref('')
  const reproCopied = ref(false)
  const reproPlaywrightCopied = ref(false)
  const domChangesPanelOpen = ref(false)
  const domChangesReport = ref<BrowserDomChangesReport | null>(null)
  const domChangesState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const domChangesError = ref('')
  const domChangesCopied = ref(false)
  const visualComparePanelOpen = ref(false)
  const visualCompareReport = ref<BrowserVisualCompareView | null>(null)
  const visualCompareState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const visualCompareError = ref('')
  const visualCompareCopied = ref(false)
  const inspectorIssuesOpen = ref(false)
  const inspectorIssuesState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const inspectorIssuesReport = ref<BrowserInspectorIssuesReport | null>(null)
  const inspectorIssuesError = ref('')
  const inspectorIssuesCopied = ref(false)

  let generation = 0
  const sequences: Record<Domain, number> = {
    accessibility: 0,
    quality: 0,
    performance: 0,
    design: 0,
    metadata: 0,
    security: 0,
    coverage: 0,
    cpu: 0,
    memory: 0,
    debug: 0,
    repro: 0,
    dom: 0,
    visual: 0,
    issues: 0
  }
  let domRefreshTimer: number | undefined
  const feedbackTimers = new Map<CopyFeedback, number>()

  function begin(domain: Domain): { tab: BrowserTabState; generation: number; sequence: number } | null {
    const tab = options.activeTab.value
    if (!tab || tab.url.startsWith('hronaut://home')) return null
    return { tab, generation, sequence: ++sequences[domain] }
  }

  function current(domain: Domain, request: { tab: BrowserTabState; generation: number; sequence: number }): boolean {
    return request.generation === generation
      && request.sequence === sequences[domain]
      && options.activeTab.value?.id === request.tab.id
      && options.activeTab.value.url === request.tab.url
  }

  function scheduleFeedbackReset(key: CopyFeedback, callback: () => void): void {
    const previous = feedbackTimers.get(key)
    if (previous !== undefined) window.clearTimeout(previous)
    const timer = window.setTimeout(() => {
      feedbackTimers.delete(key)
      callback()
    }, 1_500)
    feedbackTimers.set(key, timer)
  }

  function resetCopyFeedback(): void {
    for (const timer of feedbackTimers.values()) window.clearTimeout(timer)
    feedbackTimers.clear()
    debugReportCopied.value = false
    reproCopied.value = false
    reproPlaywrightCopied.value = false
    domChangesCopied.value = false
    visualCompareCopied.value = false
    inspectorIssuesCopied.value = false
    qualityAuditCopied.value = false
  }

  async function copyWithFeedback(key: CopyFeedback, payload: string, copied: Ref<boolean>): Promise<void> {
    const expectedGeneration = generation
    if (!await options.copyText(payload) || expectedGeneration !== generation) return
    copied.value = true
    scheduleFeedbackReset(key, () => (copied.value = false))
  }

  async function runPerformanceReport(action: BrowserPerformanceAction = 'measure'): Promise<void> {
    const request = begin('performance')
    if (!request) return
    options.closeTransientPanels()
    performancePanelOpen.value = true
    performanceState.value = 'running'
    performanceError.value = ''
    try {
      const report = await options.browser.measurePerformance({ tabId: request.tab.id, settleMs: 800, action })
      if (!current('performance', request)) return
      performanceReport.value = report
      performanceState.value = 'complete'
    } catch (cause) {
      if (!current('performance', request)) return
      performanceState.value = 'error'
      performanceError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function togglePerformanceReport(): void {
    if (performancePanelOpen.value) performancePanelOpen.value = false
    else void runPerformanceReport()
  }

  async function runDesignOverview(): Promise<void> {
    const request = begin('design')
    if (!request) return
    options.closeTransientPanels()
    designOverviewPanelOpen.value = true
    designOverviewState.value = 'loading'
    designOverviewError.value = ''
    try {
      const report = await options.browser.inspectDesign(request.tab.id)
      if (!current('design', request)) return
      designOverviewReport.value = report
      designOverviewState.value = 'ready'
    } catch (cause) {
      if (!current('design', request)) return
      designOverviewState.value = 'error'
      designOverviewError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleDesignOverview(): void {
    if (designOverviewPanelOpen.value) designOverviewPanelOpen.value = false
    else void runDesignOverview()
  }

  async function runPageMetadata(): Promise<void> {
    const request = begin('metadata')
    if (!request) return
    options.closeTransientPanels()
    pageMetadataPanelOpen.value = true
    pageMetadataState.value = 'loading'
    pageMetadataError.value = ''
    try {
      const report = await options.browser.inspectPageMetadata(request.tab.id)
      if (!current('metadata', request)) return
      pageMetadataReport.value = report
      pageMetadataState.value = 'ready'
    } catch (cause) {
      if (!current('metadata', request)) return
      pageMetadataState.value = 'error'
      pageMetadataError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function togglePageMetadata(): void {
    if (pageMetadataPanelOpen.value) pageMetadataPanelOpen.value = false
    else void runPageMetadata()
  }

  async function runSecurityReport(): Promise<void> {
    const request = begin('security')
    if (!request) return
    options.closeTransientPanels()
    securityPanelOpen.value = true
    securityReportState.value = 'loading'
    securityReportError.value = ''
    try {
      const report = await options.browser.inspectSecurity(request.tab.id)
      if (!current('security', request)) return
      securityReport.value = report
      securityReportState.value = 'ready'
    } catch (cause) {
      if (!current('security', request)) return
      securityReportState.value = 'error'
      securityReportError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleSecurityReport(): void {
    if (securityPanelOpen.value) securityPanelOpen.value = false
    else void runSecurityReport()
  }

  async function manageCodeCoverage(action: 'get' | 'start' | 'stop' | 'clear', reload = true): Promise<void> {
    const request = begin('coverage')
    if (!request) return
    coverageState.value = 'loading'
    coverageError.value = ''
    try {
      const result = await options.browser.manageCodeCoverage({
        tabId: request.tab.id,
        action,
        mode: coverageMode.value,
        reload
      })
      if (!current('coverage', request)) return
      coverageResult.value = result
      coverageState.value = 'ready'
    } catch (cause) {
      if (!current('coverage', request)) return
      coverageState.value = 'error'
      coverageError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleCodeCoverage(): void {
    if (coveragePanelOpen.value) {
      coveragePanelOpen.value = false
      return
    }
    options.closeTransientPanels()
    coveragePanelOpen.value = true
    void manageCodeCoverage('get')
  }

  async function manageCpuProfile(action: 'get' | 'start' | 'stop' | 'clear'): Promise<void> {
    const request = begin('cpu')
    if (!request) return
    cpuProfileState.value = 'loading'
    cpuProfileError.value = ''
    try {
      const result = await options.browser.manageCpuProfile({ tabId: request.tab.id, action })
      if (!current('cpu', request)) return
      cpuProfileResult.value = result
      cpuProfileState.value = 'ready'
    } catch (cause) {
      if (!current('cpu', request)) return
      cpuProfileState.value = 'error'
      cpuProfileError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleCpuProfile(): void {
    if (cpuProfilePanelOpen.value) {
      cpuProfilePanelOpen.value = false
      return
    }
    options.closeTransientPanels()
    cpuProfilePanelOpen.value = true
    void manageCpuProfile('get')
  }

  async function runMemoryReport(action: 'measure' | 'set-baseline' = 'measure', collectGarbage = false): Promise<void> {
    const request = begin('memory')
    if (!request) return
    options.closeTransientPanels()
    memoryPanelOpen.value = true
    memoryState.value = 'running'
    memoryError.value = ''
    try {
      const report = await options.browser.measureMemory({ tabId: request.tab.id, action, collectGarbage })
      if (!current('memory', request)) return
      memoryReport.value = report
      memoryState.value = 'complete'
    } catch (cause) {
      if (!current('memory', request)) return
      memoryState.value = 'error'
      memoryError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function clearMemoryBaseline(): Promise<void> {
    const request = begin('memory')
    if (!request) return
    memoryState.value = 'running'
    memoryError.value = ''
    try {
      const previous = memoryReport.value
      const cleared = await options.browser.measureMemory({ tabId: request.tab.id, action: 'clear-baseline' })
      if (!current('memory', request)) return
      const preserveCurrent = previous?.tabId === cleared.tabId && previous.url === cleared.url && previous.current
      memoryReport.value = {
        ...cleared,
        ...(preserveCurrent ? { current: previous.current, forcedGarbageCollection: previous.forcedGarbageCollection } : {})
      }
      memoryState.value = 'complete'
    } catch (cause) {
      if (!current('memory', request)) return
      memoryState.value = 'error'
      memoryError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function manageMemoryAllocation(action: 'start' | 'stop' | 'clear'): Promise<void> {
    const request = begin('memory')
    if (!request) return
    options.closeTransientPanels()
    memoryPanelOpen.value = true
    memoryState.value = 'running'
    memoryError.value = ''
    try {
      const memoryAction = action === 'start'
        ? 'start-allocation-sampling'
        : action === 'stop' ? 'stop-allocation-sampling' : 'clear-allocation-sampling'
      let report = await options.browser.measureMemory({ tabId: request.tab.id, action: memoryAction })
      if (action === 'clear') report = await options.browser.measureMemory({ tabId: request.tab.id, action: 'measure' })
      if (!current('memory', request)) return
      memoryReport.value = report
      memoryState.value = 'complete'
    } catch (cause) {
      if (!current('memory', request)) return
      memoryState.value = 'error'
      memoryError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleMemoryReport(): void {
    if (memoryPanelOpen.value) memoryPanelOpen.value = false
    else void runMemoryReport()
  }

  async function runDebugReport(): Promise<void> {
    const request = begin('debug')
    if (!request) return
    options.closeTransientPanels()
    debugReportPanelOpen.value = true
    debugReportState.value = 'running'
    debugReportError.value = ''
    debugReportCopied.value = false
    try {
      const report = await options.browser.createDebugReport({
        tabId: request.tab.id,
        maxConsoleMessages: 30,
        maxNetworkRequests: 30,
        includeSuccessfulRequests: false
      })
      if (!current('debug', request)) return
      debugReport.value = report
      debugReportState.value = 'complete'
    } catch (cause) {
      if (!current('debug', request)) return
      debugReportState.value = 'error'
      debugReportError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleDebugReport(): void {
    if (debugReportPanelOpen.value) debugReportPanelOpen.value = false
    else void runDebugReport()
  }

  async function copyDebugReport(): Promise<void> {
    if (!debugReport.value) return
    await copyWithFeedback('debug', JSON.stringify(debugReport.value, null, 2), debugReportCopied)
  }

  async function manageRepro(action: 'start' | 'get' | 'stop' | 'clear'): Promise<void> {
    const request = begin('repro')
    if (!request) return
    reproState.value = 'loading'
    reproError.value = ''
    if (action !== 'get') {
      reproCopied.value = false
      reproPlaywrightCopied.value = false
    }
    try {
      const recording = await options.browser.manageRepro(action, request.tab.id)
      if (!current('repro', request)) return
      reproRecording.value = recording
      reproState.value = 'ready'
    } catch (cause) {
      if (!current('repro', request)) return
      reproState.value = 'error'
      reproError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleReproRecorder(): void {
    if (reproPanelOpen.value) {
      reproPanelOpen.value = false
      return
    }
    options.closeTransientPanels()
    reproPanelOpen.value = true
    void manageRepro('get')
  }

  const startReproRecording = (): Promise<void> => manageRepro('start')
  const stopReproRecording = (): Promise<void> => manageRepro('stop')
  const clearReproRecording = (): Promise<void> => manageRepro('clear')

  async function copyReproRecording(): Promise<void> {
    if (!reproRecording.value) return
    await copyWithFeedback('repro', JSON.stringify(reproRecording.value, null, 2), reproCopied)
  }

  async function copyReproPlaywright(): Promise<void> {
    if (!reproRecording.value) return
    await copyWithFeedback('repro-playwright', formatReproAsPlaywright(reproRecording.value), reproPlaywrightCopied)
  }

  async function manageDomChanges(action: 'start' | 'get' | 'stop' | 'clear', quiet = false): Promise<void> {
    const request = begin('dom')
    if (!request) return
    if (!quiet) domChangesState.value = 'loading'
    domChangesError.value = ''
    if (!quiet) domChangesCopied.value = false
    try {
      const report = await options.browser.manageDomChanges(action, request.tab.id)
      if (!current('dom', request)) return
      domChangesReport.value = report
      domChangesState.value = 'ready'
    } catch (cause) {
      if (!current('dom', request)) return
      domChangesState.value = 'error'
      domChangesError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleDomChanges(): void {
    if (domChangesPanelOpen.value) domChangesPanelOpen.value = false
    else {
      options.closeTransientPanels()
      domChangesPanelOpen.value = true
    }
  }

  async function copyDomChanges(): Promise<void> {
    if (!domChangesReport.value) return
    await copyWithFeedback('dom', JSON.stringify(domChangesReport.value, null, 2), domChangesCopied)
  }

  async function manageVisualCompare(action: 'get' | 'set-baseline' | 'compare' | 'clear'): Promise<void> {
    const request = begin('visual')
    if (!request) return
    visualCompareState.value = 'loading'
    visualCompareError.value = ''
    visualCompareCopied.value = false
    try {
      const report = await options.browser.visualCompare({ tabId: request.tab.id, action, settleMs: 200 })
      if (!current('visual', request)) return
      visualCompareReport.value = report
      visualCompareState.value = 'ready'
    } catch (cause) {
      if (!current('visual', request)) return
      visualCompareState.value = 'error'
      visualCompareError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleVisualCompare(): void {
    if (visualComparePanelOpen.value) visualComparePanelOpen.value = false
    else {
      options.closeTransientPanels()
      visualComparePanelOpen.value = true
      void manageVisualCompare('get')
    }
  }

  async function copyVisualDiff(): Promise<void> {
    const request = begin('visual')
    if (!request || visualCompareReport.value?.status !== 'compared') return
    visualCompareError.value = ''
    try {
      await options.browser.copyVisualDiff(request.tab.id)
      if (!current('visual', request)) return
      visualCompareCopied.value = true
      scheduleFeedbackReset('visual', () => (visualCompareCopied.value = false))
    } catch (cause) {
      if (!current('visual', request)) return
      visualCompareState.value = 'error'
      visualCompareError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function refreshInspectorIssues(clear = false): Promise<void> {
    const request = begin('issues')
    if (!request) return
    inspectorIssuesState.value = 'loading'
    inspectorIssuesError.value = ''
    inspectorIssuesCopied.value = false
    try {
      const report = await options.browser.listInspectorIssues(request.tab.id, clear)
      if (!current('issues', request)) return
      inspectorIssuesReport.value = report
      inspectorIssuesState.value = 'ready'
    } catch (cause) {
      if (!current('issues', request)) return
      inspectorIssuesState.value = 'error'
      inspectorIssuesError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleInspectorIssues(): void {
    if (inspectorIssuesOpen.value) inspectorIssuesOpen.value = false
    else {
      options.closeTransientPanels()
      inspectorIssuesOpen.value = true
      void refreshInspectorIssues()
    }
  }

  const clearInspectorIssues = (): Promise<void> => refreshInspectorIssues(true)

  async function copyInspectorIssues(): Promise<void> {
    if (!inspectorIssuesReport.value) return
    await copyWithFeedback('issues', JSON.stringify(inspectorIssuesReport.value, null, 2), inspectorIssuesCopied)
  }

  async function runAccessibilityAudit(): Promise<void> {
    const request = begin('accessibility')
    if (!request) return
    options.closeTransientPanels()
    accessibilityPanelOpen.value = true
    accessibilityAuditState.value = 'running'
    accessibilityAuditError.value = ''
    accessibilityAudit.value = null
    try {
      const audit = await options.browser.runAccessibilityAudit({
        tabId: request.tab.id,
        standard: 'wcag-aa',
        maxViolations: 50,
        maxNodesPerViolation: 3
      })
      if (!current('accessibility', request)) return
      accessibilityAudit.value = audit
      accessibilityAuditState.value = 'complete'
    } catch (cause) {
      if (!current('accessibility', request)) return
      accessibilityAuditState.value = 'error'
      accessibilityAuditError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleAccessibilityAudit(): void {
    if (accessibilityPanelOpen.value) accessibilityPanelOpen.value = false
    else void runAccessibilityAudit()
  }

  async function runQualityAudit(): Promise<void> {
    const request = begin('quality')
    if (!request) return
    options.closeTransientPanels()
    qualityAuditPanelOpen.value = true
    qualityAuditState.value = 'running'
    qualityAuditError.value = ''
    qualityAuditReport.value = null
    qualityAuditCopied.value = false
    try {
      const report = await options.browser.runQualityAudit(request.tab.id)
      if (!current('quality', request)) return
      qualityAuditReport.value = report
      qualityAuditState.value = 'complete'
    } catch (cause) {
      if (!current('quality', request)) return
      qualityAuditState.value = 'error'
      qualityAuditError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleQualityAudit(): void {
    if (qualityAuditPanelOpen.value) qualityAuditPanelOpen.value = false
    else void runQualityAudit()
  }

  async function copyQualityAudit(): Promise<void> {
    if (!qualityAuditReport.value) return
    await copyWithFeedback('quality', JSON.stringify(qualityAuditReport.value, null, 2), qualityAuditCopied)
  }

  function resetForContext(): void {
    generation += 1
    for (const domain of Object.keys(sequences) as Domain[]) sequences[domain] += 1
    resetCopyFeedback()
    const keepOpen = options.keepsSeparatePanelOpen()
    const closeForContextChange = (open: Ref<boolean>): void => {
      if (!keepOpen && open.value) open.value = false
    }
    closeForContextChange(accessibilityPanelOpen)
    closeForContextChange(qualityAuditPanelOpen)
    closeForContextChange(performancePanelOpen)
    closeForContextChange(designOverviewPanelOpen)
    closeForContextChange(pageMetadataPanelOpen)
    closeForContextChange(securityPanelOpen)
    closeForContextChange(coveragePanelOpen)
    closeForContextChange(cpuProfilePanelOpen)
    closeForContextChange(memoryPanelOpen)
    closeForContextChange(debugReportPanelOpen)
    closeForContextChange(reproPanelOpen)
    closeForContextChange(domChangesPanelOpen)
    closeForContextChange(visualComparePanelOpen)
    closeForContextChange(inspectorIssuesOpen)
    accessibilityAudit.value = null
    accessibilityAuditState.value = 'idle'
    accessibilityAuditError.value = ''
    qualityAuditReport.value = null
    qualityAuditState.value = 'idle'
    qualityAuditError.value = ''
    performanceReport.value = null
    performanceState.value = 'idle'
    performanceError.value = ''
    designOverviewReport.value = null
    designOverviewState.value = 'idle'
    designOverviewError.value = ''
    pageMetadataReport.value = null
    pageMetadataState.value = 'idle'
    pageMetadataError.value = ''
    securityReport.value = null
    securityReportState.value = 'idle'
    securityReportError.value = ''
    coverageResult.value = null
    coverageState.value = 'idle'
    coverageError.value = ''
    cpuProfileResult.value = null
    cpuProfileState.value = 'idle'
    cpuProfileError.value = ''
    memoryReport.value = null
    memoryState.value = 'idle'
    memoryError.value = ''
    debugReport.value = null
    debugReportState.value = 'idle'
    debugReportError.value = ''
    reproRecording.value = null
    reproState.value = 'idle'
    reproError.value = ''
    domChangesReport.value = null
    domChangesState.value = 'idle'
    domChangesError.value = ''
    visualCompareReport.value = null
    visualCompareState.value = 'idle'
    visualCompareError.value = ''
    inspectorIssuesReport.value = null
    inspectorIssuesState.value = 'idle'
    inspectorIssuesError.value = ''
  }

  const stopTabWatcher = watch(
    () => [options.activeTab.value?.id, options.activeTab.value?.url] as const,
    ([tabId, url], previousContext) => {
      if (previousContext && tabId === previousContext[0] && url === previousContext[1]) return
      resetForContext()
    },
    { immediate: true }
  )
  const stopReproWatcher = watch(
    () => [options.activeTab.value?.id, options.activeTab.value?.reproRecording?.active, options.activeTab.value?.reproRecording?.stepCount] as const,
    ([tabId]) => {
      if (tabId && reproPanelOpen.value) void manageRepro('get')
    }
  )
  const stopCoverageWatcher = watch(() => options.activeTab.value?.codeCoverageRecording?.startedAt, (currentValue, previous) => {
    if (!currentValue && previous && coveragePanelOpen.value && coverageResult.value?.status === 'recording') void manageCodeCoverage('get')
  })
  const stopCpuWatcher = watch(() => options.activeTab.value?.cpuProfileRecording?.startedAt, (currentValue, previous) => {
    if (!currentValue && previous && cpuProfilePanelOpen.value && cpuProfileResult.value?.status === 'recording') void manageCpuProfile('get')
  })
  const stopMemoryWatcher = watch(() => options.activeTab.value?.memoryAllocationRecording?.startedAt, (currentValue, previous) => {
    if (!currentValue && previous && memoryPanelOpen.value && memoryReport.value?.allocationStatus === 'recording') {
      memoryReport.value = {
        ...memoryReport.value,
        allocationStatus: 'idle',
        allocationRecording: undefined,
        allocationProfile: undefined
      }
    }
  })
  const stopDomTabWatcher = watch(
    () => [options.activeTab.value?.id, options.activeTab.value?.domChangesRecording?.active, options.activeTab.value?.domChangesRecording?.changeCount] as const,
    ([tabId]) => {
      if (tabId && domChangesPanelOpen.value) void manageDomChanges('get', true)
    }
  )
  const stopDomOpenWatcher = watch(domChangesPanelOpen, (open) => {
    if (domRefreshTimer !== undefined) {
      window.clearInterval(domRefreshTimer)
      domRefreshTimer = undefined
    }
    if (!open) return
    void manageDomChanges('get')
    domRefreshTimer = window.setInterval(() => {
      if (domChangesPanelOpen.value && domChangesReport.value?.active) void manageDomChanges('get', true)
    }, 1_000)
  }, { immediate: true })

  function dispose(): void {
    generation += 1
    stopTabWatcher()
    stopReproWatcher()
    stopCoverageWatcher()
    stopCpuWatcher()
    stopMemoryWatcher()
    stopDomTabWatcher()
    stopDomOpenWatcher()
    if (domRefreshTimer !== undefined) window.clearInterval(domRefreshTimer)
    resetCopyFeedback()
  }

  return {
    accessibilityAuditState,
    accessibilityAudit,
    accessibilityAuditError,
    accessibilityPanelOpen,
    qualityAuditState,
    qualityAuditReport,
    qualityAuditError,
    qualityAuditPanelOpen,
    qualityAuditCopied,
    performanceState,
    performanceReport,
    performanceError,
    performancePanelOpen,
    designOverviewPanelOpen,
    designOverviewReport,
    designOverviewState,
    designOverviewError,
    pageMetadataPanelOpen,
    pageMetadataReport,
    pageMetadataState,
    pageMetadataError,
    securityPanelOpen,
    securityReport,
    securityReportState,
    securityReportError,
    coveragePanelOpen,
    coverageResult,
    coverageState,
    coverageError,
    coverageMode,
    cpuProfilePanelOpen,
    cpuProfileResult,
    cpuProfileState,
    cpuProfileError,
    memoryState,
    memoryReport,
    memoryError,
    memoryPanelOpen,
    debugReportState,
    debugReport,
    debugReportError,
    debugReportPanelOpen,
    debugReportCopied,
    reproPanelOpen,
    reproRecording,
    reproState,
    reproError,
    reproCopied,
    reproPlaywrightCopied,
    domChangesPanelOpen,
    domChangesReport,
    domChangesState,
    domChangesError,
    domChangesCopied,
    visualComparePanelOpen,
    visualCompareReport,
    visualCompareState,
    visualCompareError,
    visualCompareCopied,
    inspectorIssuesOpen,
    inspectorIssuesState,
    inspectorIssuesReport,
    inspectorIssuesError,
    inspectorIssuesCopied,
    runPerformanceReport,
    togglePerformanceReport,
    runDesignOverview,
    toggleDesignOverview,
    runPageMetadata,
    togglePageMetadata,
    runSecurityReport,
    toggleSecurityReport,
    manageCodeCoverage,
    toggleCodeCoverage,
    manageCpuProfile,
    toggleCpuProfile,
    runMemoryReport,
    clearMemoryBaseline,
    manageMemoryAllocation,
    toggleMemoryReport,
    runDebugReport,
    toggleDebugReport,
    copyDebugReport,
    manageRepro,
    toggleReproRecorder,
    startReproRecording,
    stopReproRecording,
    clearReproRecording,
    copyReproRecording,
    copyReproPlaywright,
    manageDomChanges,
    toggleDomChanges,
    copyDomChanges,
    manageVisualCompare,
    toggleVisualCompare,
    copyVisualDiff,
    refreshInspectorIssues,
    toggleInspectorIssues,
    clearInspectorIssues,
    copyInspectorIssues,
    runAccessibilityAudit,
    toggleAccessibilityAudit,
    runQualityAudit,
    toggleQualityAudit,
    copyQualityAudit,
    resetForContext,
    dispose
  }
}

export type DiagnosticsController = ReturnType<typeof useDiagnosticsController>
