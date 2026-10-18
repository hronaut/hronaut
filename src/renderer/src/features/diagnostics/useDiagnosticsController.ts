import type { CopyTextWithFeedback } from '../../composables/useShellFeedbackController.js'
import { isHronautHomeUrl } from '../../../../shared/home-url.js'
import { watch, type Ref } from 'vue'
import { usePageMetadata } from './page-metadata/usePageMetadata.js'
import { useAccessibilityAudit } from './accessibility-audit/useAccessibilityAudit.js'
import { useCodeCoverage } from './code-coverage/useCodeCoverage.js'
import { useCpuProfile } from './cpu-profile/useCpuProfile.js'
import { useDebugReport } from './debug-report/useDebugReport.js'
import { useDesignOverview } from './design-overview/useDesignOverview.js'
import { useDomChanges } from './dom-changes/useDomChanges.js'
import { useInspectorIssues } from './inspector-issues/useInspectorIssues.js'
import { useMemoryReport } from './memory-report/useMemoryReport.js'
import { usePerformanceReport } from './performance-report/usePerformanceReport.js'
import { useQualityAudit } from './quality-audit/useQualityAudit.js'
import { useReproRecorder } from './repro-recorder/useReproRecorder.js'
import { useSecurityReport } from './security-report/useSecurityReport.js'
import { useVisualCompare } from './visual-compare/useVisualCompare.js'
import type {
  BrowserDomChangesAction,
  BrowserTabState,
  HronautApi
} from '../../../../shared/types.js'

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
  | 'security'
  | 'coverage'
  | 'cpu'
  | 'memory'
  | 'debug'
  | 'repro'
  | 'dom'
  | 'visual'
  | 'issues'
type RecorderDomain = 'repro' | 'dom' | 'coverage' | 'cpu'
type CopyFeedback = 'debug' | 'repro' | 'repro-playwright' | 'dom' | 'visual' | 'issues' | 'quality'

export interface DiagnosticsControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: DiagnosticsBrowserApi
  translate: Translate
  copyText: CopyTextWithFeedback
  closeTransientPanels: () => void
  keepsSeparatePanelOpen: () => boolean
}

export function useDiagnosticsController(options: DiagnosticsControllerOptions) {
  const recorderCopyGenerations = { repro: 0, dom: 0 }
  let generation = 0
  const sequences: Record<Domain, number> = {
    accessibility: 0,
    quality: 0,
    performance: 0,
    design: 0,
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
  const recorderMutations: Partial<Record<RecorderDomain, NonNullable<ReturnType<typeof begin>>>> = {}
  const feedbackTimers = new Map<CopyFeedback, number>()
  const copySequences = new Map<CopyFeedback, number>()

  // Each panel family owns its state and actions. The request lifetime, copy
  // feedback, context reset and watcher order stay here, shared by all panels.
  const { accessibilityAuditState, accessibilityAudit, accessibilityAuditError, accessibilityPanelOpen,
    runAccessibilityAudit, toggleAccessibilityAudit } = useAccessibilityAudit(options, { begin, current })
  const { qualityAuditState, qualityAuditReport, qualityAuditError, qualityAuditPanelOpen, qualityAuditCopied,
    runQualityAudit, toggleQualityAudit, copyQualityAudit } = useQualityAudit(options, { begin, current, copyWithFeedback })
  const { performanceState, performanceReport, performanceError, performancePanelOpen,
    runPerformanceReport, togglePerformanceReport } = usePerformanceReport(options, { begin, current })
  const { designOverviewPanelOpen, designOverviewReport, designOverviewState, designOverviewError,
    runDesignOverview, toggleDesignOverview } = useDesignOverview(options, { begin, current })
  const metadata = usePageMetadata(options)
  const { pageMetadataPanelOpen, pageMetadataReport, pageMetadataState, pageMetadataError,
    runPageMetadata, togglePageMetadata } = metadata
  const { securityPanelOpen, securityReport, securityReportState, securityReportError,
    runSecurityReport, toggleSecurityReport } = useSecurityReport(options, { begin, current })
  const { coveragePanelOpen, coverageResult, coverageState, coverageError, coverageMode,
    manageCodeCoverage, toggleCodeCoverage, watchCodeCoverageRecording } = useCodeCoverage(
    options, { beginRecorderRequest, finishRecorderRequest, current })
  const { cpuProfilePanelOpen, cpuProfileResult, cpuProfileState, cpuProfileError,
    manageCpuProfile, toggleCpuProfile, watchCpuProfileRecording } = useCpuProfile(
    options, { beginRecorderRequest, finishRecorderRequest, current })
  const { memoryState, memoryReport, memoryError, memoryPanelOpen, runMemoryReport, clearMemoryBaseline,
    manageMemoryAllocation, toggleMemoryReport, watchMemoryAllocationRecording } = useMemoryReport(options, { begin, current })
  const { debugReportState, debugReport, debugReportError, debugReportPanelOpen, debugReportCopied,
    runDebugReport, toggleDebugReport, copyDebugReport } = useDebugReport(options, { begin, current, copyWithFeedback })
  const { reproPanelOpen, reproRecording, reproState, reproError, reproCopied, reproPlaywrightCopied,
    manageRepro, toggleReproRecorder, startReproRecording, stopReproRecording, clearReproRecording,
    copyReproRecording, copyReproPlaywright, watchReproRecording } = useReproRecorder(
    options, { beginRecorderRequest, finishRecorderRequest, current, copyWithFeedback })
  const { domChangesPanelOpen, domChangesReport, domChangesState, domChangesError, domChangesCopied,
    manageDomChanges, toggleDomChanges, copyDomChanges, watchDomChanges } = useDomChanges(
    options, { beginRecorderRequest, finishRecorderRequest, current, copyWithFeedback })
  const { visualComparePanelOpen, visualCompareReport, visualCompareState, visualCompareError, visualCompareCopied,
    manageVisualCompare, toggleVisualCompare, copyVisualDiff } = useVisualCompare(
    options, { begin, current, feedbackTimers, scheduleFeedbackReset })
  const { inspectorIssuesOpen, inspectorIssuesState, inspectorIssuesReport, inspectorIssuesError, inspectorIssuesCopied,
    refreshInspectorIssues, toggleInspectorIssues, clearInspectorIssues, copyInspectorIssues } = useInspectorIssues(
    options, { begin, current, copyWithFeedback })

  const textCopyPanels: Array<{ open: Ref<boolean>; copies: Array<{ key: CopyFeedback; copied: Ref<boolean> }> }> = [
    { open: debugReportPanelOpen, copies: [{ key: 'debug', copied: debugReportCopied }] },
    { open: qualityAuditPanelOpen, copies: [{ key: 'quality', copied: qualityAuditCopied }] },
    { open: inspectorIssuesOpen, copies: [{ key: 'issues', copied: inspectorIssuesCopied }] },
    { open: reproPanelOpen, copies: [{ key: 'repro', copied: reproCopied }, { key: 'repro-playwright', copied: reproPlaywrightCopied }] },
    { open: domChangesPanelOpen, copies: [{ key: 'dom', copied: domChangesCopied }] }
  ]
  const stopTextCopyPanelWatchers = textCopyPanels.map(({ open, copies }) => watch(open, isOpen => {
    if (isOpen) return
    for (const { key, copied } of copies) {
      // A dispatched clipboard write can finish, but its closed panel no longer owns feedback.
      copySequences.set(key, (copySequences.get(key) ?? 0) + 1)
      const timer = feedbackTimers.get(key)
      if (timer !== undefined) window.clearTimeout(timer)
      feedbackTimers.delete(key)
      copied.value = false
    }
  }, { flush: 'sync' }))

  function begin(domain: Domain): { tab: BrowserTabState; generation: number; sequence: number } | null {
    const tab = options.activeTab.value
    if (!tab || isHronautHomeUrl(tab.url)) return null
    return { tab: { ...tab }, generation, sequence: ++sequences[domain] }
  }

  function current(domain: Domain, request: { tab: BrowserTabState; generation: number; sequence: number }): boolean {
    return request.generation === generation
      && request.sequence === sequences[domain]
      && options.activeTab.value?.id === request.tab.id
      && options.activeTab.value.url === request.tab.url
      && options.activeTab.value.navigationGeneration === request.tab.navigationGeneration
  }

  function beginRecorderRequest(domain: RecorderDomain, action: BrowserDomChangesAction | 'checkpoint'): ReturnType<typeof begin> {
    // Background reads must not supersede an in-flight user action on this page.
    const mutation = recorderMutations[domain]
    if (action === 'get' && mutation && current(domain, mutation)) return null
    const request = begin(domain)
    if (request && action !== 'get') {
      recorderMutations[domain] = request
      if (domain === 'repro' || domain === 'dom') recorderCopyGenerations[domain] += 1
    }
    return request
  }

  function finishRecorderRequest(domain: RecorderDomain, request: NonNullable<ReturnType<typeof begin>>): void {
    if (recorderMutations[domain] === request) delete recorderMutations[domain]
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
    copySequences.clear()
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
    const sequence = (copySequences.get(key) ?? 0) + 1
    copySequences.set(key, sequence)
    const previous = feedbackTimers.get(key)
    if (previous !== undefined) window.clearTimeout(previous)
    feedbackTimers.delete(key)
    copied.value = false
    const reportDomain = key === 'debug' || key === 'quality' || key === 'issues' ? key : undefined
    const expectedReportSequence = reportDomain ? sequences[reportDomain] : undefined
    const recorder = key === 'dom' ? 'dom'
      : key === 'repro' || key === 'repro-playwright' ? 'repro' : undefined
    const expectedRecorderGeneration = recorder ? recorderCopyGenerations[recorder] : undefined
    const ownsFeedback = (): boolean => (
      expectedGeneration === generation
      && sequence === copySequences.get(key)
      && (!reportDomain || expectedReportSequence === sequences[reportDomain])
      && (!recorder || expectedRecorderGeneration === recorderCopyGenerations[recorder])
    )
    if (!await options.copyText(payload, ownsFeedback) || !ownsFeedback()) return
    copied.value = true
    scheduleFeedbackReset(key, () => (copied.value = false))
  }

  function resetForContext(): void {
    metadata.resetForContext()
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
    () => [options.activeTab.value?.id, options.activeTab.value?.url, options.activeTab.value?.navigationGeneration] as const,
    ([tabId, url, navigationGeneration], previousContext) => {
      if (previousContext && tabId === previousContext[0] && url === previousContext[1]
        && navigationGeneration === previousContext[2]) return
      resetForContext()
    },
    { immediate: true }
  )
  // Panel watchers follow the context watcher, so a page-context change resets
  // every panel before one of them refreshes.
  const stopReproWatcher = watchReproRecording()
  const stopCoverageWatcher = watchCodeCoverageRecording()
  const stopCpuWatcher = watchCpuProfileRecording()
  const stopMemoryWatcher = watchMemoryAllocationRecording()
  const stopDomWatchers = watchDomChanges()

  function dispose(): void {
    metadata.dispose()
    generation += 1
    stopTabWatcher()
    stopReproWatcher()
    stopCoverageWatcher()
    stopCpuWatcher()
    stopMemoryWatcher()
    stopDomWatchers()
    for (const stop of stopTextCopyPanelWatchers) stop()
    resetCopyFeedback()
  }

  return {
    metadata,
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
