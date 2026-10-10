import { nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShellFeedbackController, type CopyTextWithFeedback } from '../../src/renderer/src/composables/useShellFeedbackController.js'
import { useDiagnosticsController } from '../../src/renderer/src/composables/useDiagnosticsController.js'
import type {
  BrowserDebugReport,
  BrowserDomChangesReport,
  BrowserMemoryReport,
  BrowserPerformanceReport,
  BrowserQualityAudit,
  BrowserInspectorIssuesReport,
  BrowserReproRecording,
  BrowserTabState,
  BrowserVisualCompareView
} from '../../src/shared/types.js'

function tab(id = 'tab-1'): BrowserTabState {
  return {
    id,
    title: 'Example',
    url: 'https://example.test/app',
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Value>((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

function memoryReport(action: BrowserMemoryReport['action'] = 'measure'): BrowserMemoryReport {
  return {
    tabId: 'tab-1',
    url: 'https://example.test/app',
    title: 'Example',
    action,
    forcedGarbageCollection: false,
    cleared: action === 'clear-allocation-sampling',
    allocationStatus: 'idle',
    caveats: []
  }
}

function performanceReport(tabId = 'tab-1'): BrowserPerformanceReport {
  return {
    tabId,
    url: 'https://example.test/app',
    title: 'Example',
    measuredAt: '2026-08-21T12:00:00.000Z',
    observedAt: '2026-08-21T12:00:00.000Z',
    scope: 'current-visit',
    engine: { name: 'web-vitals', version: '6.1.0' },
    action: 'measure',
    metrics: { LCP: null, INP: null, CLS: null, FCP: null, TTFB: null },
    navigation: null,
    resources: {
      count: 0,
      transferBytes: 0,
      encodedBodyBytes: 0,
      decodedBodyBytes: 0,
      byType: []
    },
    longTasks: { supported: true, count: 0, totalDurationMs: 0, blockingTimeMs: 0, longestDurationMs: 0 },
    longAnimationFrames: {
      supported: true,
      count: 0,
      totalDurationMs: 0,
      blockingDurationMs: 0,
      longestDurationMs: 0,
      renderDurationMs: 0,
      styleAndLayoutDurationMs: 0,
      frames: [],
      contributors: [],
      truncated: false
    },
    userTimings: { count: 0, entries: [], truncated: false },
    layoutShifts: { supported: true, count: 0, scoreSum: 0, recentInputCount: 0, entries: [], truncated: false },
    caveats: []
  }
}

function domReport(active = true): BrowserDomChangesReport {
  return {
    tabId: 'tab-1',
    title: 'Example',
    url: 'https://example.test/app',
    active,
    startedAt: '2026-08-21T11:59:00.000Z',
    changeCount: 0,
    entries: [],
    truncated: false,
    droppedChanges: 0,
    summary: { childList: 0, attributes: 0, text: 0, addedNodes: 0, removedNodes: 0 },
    caveats: []
  }
}

function reproRecording(): BrowserReproRecording {
  return {
    tabId: 'tab-1',
    title: 'Example',
    startedAt: '2026-08-21T12:00:00.000Z',
    stoppedAt: '2026-08-21T12:00:01.000Z',
    active: false,
    stepCount: 1,
    steps: [{
      index: 1,
      kind: 'navigate',
      occurredAt: '2026-08-21T12:00:00.000Z',
      elapsedMs: 0,
      description: 'Open Example',
      url: 'https://example.test/app'
    }],
    truncated: false,
    caveats: []
  }
}

function createController(copyTextOverride?: CopyTextWithFeedback) {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const copyText = vi.fn(copyTextOverride ?? (async () => true))
  const browser = {
    measurePerformance: vi.fn(async () => performanceReport()),
    inspectDesign: vi.fn(),
    inspectPageMetadata: vi.fn(),
    inspectSecurity: vi.fn(),
    manageCodeCoverage: vi.fn(),
    manageCpuProfile: vi.fn(),
    measureMemory: vi.fn(),
    createDebugReport: vi.fn(),
    manageRepro: vi.fn(),
    manageDomChanges: vi.fn(async () => domReport()),
    visualCompare: vi.fn(),
    copyVisualDiff: vi.fn(),
    listInspectorIssues: vi.fn(),
    runAccessibilityAudit: vi.fn(),
    runQualityAudit: vi.fn()
  }
  const controller = useDiagnosticsController({
    activeTab,
    browser,
    translate: (key) => key,
    copyText,
    closeTransientPanels: vi.fn(),
    keepsSeparatePanelOpen: () => false
  })
  return { activeTab, browser, controller, copyText }
}

function prepareVisualCopy() {
  const h = createController()
  const report: BrowserVisualCompareView = {
    action: 'compare', status: 'compared', tabId: 'tab-1', title: 'Example',
    url: 'https://example.test/app', threshold: 16, caveats: []
  }
  h.controller.visualCompareReport.value = report
  h.controller.visualCompareState.value = 'ready'
  h.browser.visualCompare.mockResolvedValue(report)
  return { ...h, report }
}

const textCopyKinds = ['debug', 'repro', 'playwright', 'dom', 'issues', 'quality'] as const

function prepareTextCopy(kind: typeof textCopyKinds[number], copyTextOverride?: CopyTextWithFeedback) {
  const h = createController(copyTextOverride)
  const report = { tabId: 'tab-1', url: 'https://example.test/app' }
  h.controller.debugReport.value = report as BrowserDebugReport
  h.controller.reproRecording.value = reproRecording()
  h.controller.domChangesReport.value = domReport(false)
  h.controller.inspectorIssuesReport.value = report as BrowserInspectorIssuesReport
  h.controller.qualityAuditReport.value = report as BrowserQualityAudit
  const action = {
    debug: { copy: h.controller.copyDebugReport, copied: h.controller.debugReportCopied },
    repro: { copy: h.controller.copyReproRecording, copied: h.controller.reproCopied },
    playwright: { copy: h.controller.copyReproPlaywright, copied: h.controller.reproPlaywrightCopied },
    dom: { copy: h.controller.copyDomChanges, copied: h.controller.domChangesCopied },
    issues: { copy: h.controller.copyInspectorIssues, copied: h.controller.inspectorIssuesCopied },
    quality: { copy: h.controller.copyQualityAudit, copied: h.controller.qualityAuditCopied }
  }[kind]
  return { ...h, ...action }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('diagnostics controller', () => {
  it.each([true, false])('clears prior image-copy feedback during another attempt (success: %s)', async succeeded => {
    vi.useFakeTimers()
    const h = prepareVisualCopy()
    const pending = deferred<void>()
    try {
      await h.controller.copyVisualDiff()
      expect(h.controller.visualCompareCopied.value).toBe(true)
      await vi.advanceTimersByTimeAsync(1_000)
      h.browser.copyVisualDiff.mockImplementationOnce(async () => {
        await pending.promise
        if (!succeeded) throw new Error('Clipboard refused')
      })
      const operation = h.controller.copyVisualDiff()
      expect(h.controller.visualCompareCopied.value).toBe(false)
      pending.resolve()
      await operation
      expect(h.controller.visualCompareCopied.value).toBe(succeeded)
      expect(h.controller.visualCompareReport.value).toEqual(h.report)
      expect(h.controller.visualCompareError.value).toBe(succeeded ? '' : 'Clipboard refused')
      await vi.advanceTimersByTimeAsync(600)
      expect(h.controller.visualCompareCopied.value).toBe(succeeded)
      await vi.advanceTimersByTimeAsync(900)
      expect(h.controller.visualCompareCopied.value).toBe(false)
    } finally { h.controller.dispose() }
  })

  it('ignores an older image-copy completion while another copy is pending', async () => {
    const h = prepareVisualCopy()
    const first = deferred<void>(), second = deferred<void>()
    h.browser.copyVisualDiff.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    try {
      const older = h.controller.copyVisualDiff(), newer = h.controller.copyVisualDiff()
      first.resolve()
      await older
      expect(h.controller.visualCompareCopied.value).toBe(false)
      second.resolve()
      await newer
      expect(h.controller.visualCompareCopied.value).toBe(true)
    } finally { h.controller.dispose() }
  })

  it.each(['report', 'navigation', 'dispose'] as const)('drops image-copy completion after %s supersedes it', async change => {
    const h = prepareVisualCopy()
    const pending = deferred<void>()
    h.browser.copyVisualDiff.mockImplementationOnce(() => pending.promise)
    try {
      const operation = h.controller.copyVisualDiff()
      if (change === 'report') await h.controller.manageVisualCompare('get')
      else if (change === 'navigation') h.activeTab.value = { ...tab(), navigationGeneration: 1 }
      else h.controller.dispose()
      pending.resolve()
      await operation
      expect(h.controller.visualCompareCopied.value).toBe(false)
    } finally { h.controller.dispose() }
  })

  it.each(textCopyKinds.flatMap(kind => [true, false].map(succeeded => ({ kind, succeeded }))))(
    'clears prior $kind feedback during a new write (success: $succeeded)', async ({ kind, succeeded }) => {
      vi.useFakeTimers()
      const h = prepareTextCopy(kind)
      const pending = deferred<boolean>()
      await h.copy()
      expect(h.copied.value).toBe(true)
      const payload = h.copyText.mock.calls[0][0]
      await vi.advanceTimersByTimeAsync(1_000)
      h.copyText.mockImplementationOnce(() => pending.promise)
      const operation = h.copy()
      expect(h.copied.value).toBe(false)
      expect(h.copyText.mock.calls[1][0]).toEqual(payload)
      pending.resolve(succeeded)
      await operation
      expect(h.copied.value).toBe(succeeded)
      await vi.advanceTimersByTimeAsync(600)
      expect(h.copied.value).toBe(succeeded)
      await vi.advanceTimersByTimeAsync(900)
      expect(h.copied.value).toBe(false)
      h.controller.dispose()
    }
  )

  it.each(textCopyKinds)('ignores older %s copy completion while a newer write is pending or refused', async kind => {
    const h = prepareTextCopy(kind)
    const first = deferred<boolean>(), second = deferred<boolean>()
    h.copyText.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    const older = h.copy(), newer = h.copy()
    first.resolve(true)
    await older
    expect(h.copied.value).toBe(false)
    second.resolve(false)
    await newer
    expect(h.copied.value).toBe(false)
    h.controller.dispose()
  })

  it('keeps another diagnostic report copy indicator independent', async () => {
    vi.useFakeTimers()
    const h = prepareTextCopy('debug')
    await h.copy()
    const pending = deferred<boolean>()
    h.copyText.mockImplementationOnce(() => pending.promise)
    const quality = h.controller.copyQualityAudit()
    expect(h.copied.value).toBe(true)
    expect(h.controller.qualityAuditCopied.value).toBe(false)
    pending.resolve(true)
    await quality
    expect(h.copied.value).toBe(true)
    expect(h.controller.qualityAuditCopied.value).toBe(true)
    h.controller.dispose()
  })

  it.each(['switch', 'reload', 'dispose'] as const)('does not measure after allocation clear loses its context through %s', async (change) => {
    const pending = deferred<BrowserMemoryReport>()
    const { activeTab, browser, controller } = createController()
    browser.measureMemory.mockReturnValueOnce(pending.promise)
    const clearing = controller.manageMemoryAllocation('clear')
    if (change === 'dispose') controller.dispose()
    else activeTab.value = change === 'switch' ? tab('tab-2') : { ...tab(), navigationGeneration: 1 }
    await nextTick()
    pending.resolve(memoryReport('clear-allocation-sampling'))
    await clearing
    expect(browser.measureMemory).toHaveBeenCalledTimes(1)
    expect(controller.memoryReport.value).toBeNull()
    if (change !== 'dispose') controller.dispose()
  })

  it('does not measure again after a newer memory request supersedes allocation clear', async () => {
    const pending = deferred<BrowserMemoryReport>()
    const { browser, controller } = createController()
    const newer = memoryReport('set-baseline')
    browser.measureMemory.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(newer)
    const clearing = controller.manageMemoryAllocation('clear')
    await controller.runMemoryReport('set-baseline')
    pending.resolve(memoryReport('clear-allocation-sampling'))
    await clearing
    expect(browser.measureMemory).toHaveBeenCalledTimes(2)
    expect(controller.memoryReport.value).toEqual(newer)
    expect(controller.memoryState.value).toBe('complete')
    controller.dispose()
  })

  it('refreshes memory after allocation clear when the request still owns its context', async () => {
    const { browser, controller } = createController()
    const measured = memoryReport()
    browser.measureMemory.mockResolvedValueOnce(memoryReport('clear-allocation-sampling')).mockResolvedValueOnce(measured)
    await controller.manageMemoryAllocation('clear')
    expect(browser.measureMemory).toHaveBeenNthCalledWith(1, { tabId: 'tab-1', action: 'clear-allocation-sampling' })
    expect(browser.measureMemory).toHaveBeenNthCalledWith(2, { tabId: 'tab-1', action: 'measure' })
    expect(controller.memoryReport.value).toEqual(measured)
    expect(controller.memoryState.value).toBe('complete')
    controller.dispose()
  })

  it('invalidates a pending report after a same-URL reload', async () => {
    const pending = deferred<BrowserPerformanceReport>()
    const { activeTab, browser, controller } = createController()
    browser.measurePerformance.mockImplementationOnce(() => pending.promise)
    const loading = controller.runPerformanceReport()
    activeTab.value = { ...tab(), navigationGeneration: 1 }
    await nextTick()
    pending.resolve(performanceReport())
    await loading
    expect(controller.performanceReport.value).toBeNull()
    expect(controller.performanceState.value).toBe('idle')
    controller.dispose()
  })

  it('clears a completed report on reload without stopping recorders or clearing baselines', async () => {
    const { activeTab, browser, controller } = createController()
    await controller.runPerformanceReport()
    expect(controller.performanceReport.value).not.toBeNull()
    activeTab.value!.navigationGeneration += 1
    await nextTick()
    expect(controller.performanceReport.value).toBeNull()
    expect(controller.performancePanelOpen.value).toBe(false)
    expect(browser.measurePerformance).toHaveBeenCalledTimes(1)
    expect(browser.manageRepro).not.toHaveBeenCalled()
    expect(browser.manageCodeCoverage).not.toHaveBeenCalled()
    expect(browser.manageCpuProfile).not.toHaveBeenCalled()
    expect(browser.measureMemory).not.toHaveBeenCalled()
    expect(browser.visualCompare).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('does not reuse a pending DOM read from before a same-URL reload', async () => {
    const oldRead = deferred<BrowserDomChangesReport>()
    const { activeTab, browser, controller } = createController()
    browser.manageDomChanges.mockImplementationOnce(() => oldRead.promise)
    const loading = controller.manageDomChanges('get', true)
    activeTab.value = { ...tab(), navigationGeneration: 1 }
    await nextTick()
    const fresh = { ...domReport(false), changeCount: 2 }
    browser.manageDomChanges.mockResolvedValueOnce(fresh)
    const refreshed = controller.manageDomChanges('get', true)
    oldRead.resolve(domReport())
    await Promise.all([loading, refreshed])
    expect(browser.manageDomChanges).toHaveBeenCalledTimes(2)
    expect(controller.domChangesReport.value).toEqual(fresh)
    controller.dispose()
  })

  it('invalidates an in-flight report after a same-tab reset', async () => {
    const pending = deferred<BrowserPerformanceReport>()
    const { browser, controller } = createController()
    browser.measurePerformance.mockImplementationOnce(() => pending.promise)

    const loading = controller.runPerformanceReport()
    controller.resetForContext()
    pending.resolve(performanceReport())
    await loading

    expect(controller.performanceReport.value).toBeNull()
    expect(controller.performanceState.value).toBe('idle')
    controller.dispose()
  })

  it('closes mismatched diagnostics and ignores old-tab responses', async () => {
    const pending = deferred<BrowserPerformanceReport>()
    const { activeTab, browser, controller } = createController()
    browser.measurePerformance.mockImplementationOnce(() => pending.promise)

    const loading = controller.runPerformanceReport()
    expect(controller.performancePanelOpen.value).toBe(true)
    activeTab.value = tab('tab-2')
    await nextTick()
    pending.resolve(performanceReport('tab-1'))
    await loading

    expect(controller.performancePanelOpen.value).toBe(false)
    expect(controller.performanceReport.value).toBeNull()
    expect(controller.performanceState.value).toBe('idle')
    controller.dispose()
  })

  it('invalidates an in-flight report when the same tab navigates', async () => {
    const pending = deferred<BrowserPerformanceReport>()
    const { activeTab, browser, controller } = createController()
    browser.measurePerformance.mockImplementationOnce(() => pending.promise)

    const loading = controller.runPerformanceReport()
    expect(controller.performancePanelOpen.value).toBe(true)
    activeTab.value = { ...tab(), url: 'https://example.test/next' }
    await nextTick()
    pending.resolve(performanceReport())
    await loading

    expect(controller.performancePanelOpen.value).toBe(false)
    expect(controller.performanceReport.value).toBeNull()
    expect(controller.performanceState.value).toBe('idle')
    controller.dispose()
  })

  it('keeps an in-flight report when same-page tab metadata changes', async () => {
    const pending = deferred<BrowserPerformanceReport>()
    const { activeTab, browser, controller } = createController()
    browser.measurePerformance.mockImplementationOnce(() => pending.promise)

    const loading = controller.runPerformanceReport()
    activeTab.value = { ...tab(), preserveDiagnosticLogs: true }
    await nextTick()

    expect(controller.performancePanelOpen.value).toBe(true)
    expect(controller.performanceState.value).toBe('running')
    pending.resolve(performanceReport())
    await loading
    expect(controller.performanceState.value).toBe('complete')
    controller.dispose()
  })

  it.each(['start', 'stop', 'clear'] as const)('keeps DOM recorder %s authoritative during background refreshes', async (action) => {
    const pending = deferred<BrowserDomChangesReport>()
    const { browser, controller } = createController()
    browser.manageDomChanges.mockImplementationOnce(() => pending.promise)
    const operation = controller.manageDomChanges(action)
    await controller.manageDomChanges('get', true)

    expect(controller.domChangesState.value).toBe('loading')
    expect(browser.manageDomChanges).toHaveBeenCalledTimes(1)
    const result = { ...domReport(action === 'start'), changeCount: 7 }
    pending.resolve(result)
    await operation
    expect(controller.domChangesReport.value).toEqual(result)
    expect(controller.domChangesState.value).toBe('ready')
    controller.dispose()
  })

  it('polls active DOM recordings only while the panel is open', async () => {
    vi.useFakeTimers()
    const { browser, controller } = createController()

    controller.domChangesPanelOpen.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    expect(browser.manageDomChanges).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(browser.manageDomChanges).toHaveBeenCalledTimes(2)
    controller.dispose()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(browser.manageDomChanges).toHaveBeenCalledTimes(2)
  })

  it('coalesces the panel-open DOM refresh with the matching tab-state refresh', async () => {
    const first = deferred<BrowserDomChangesReport>()
    const duplicate = deferred<BrowserDomChangesReport>()
    const { activeTab, browser, controller } = createController()
    browser.manageDomChanges
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => duplicate.promise)

    controller.domChangesPanelOpen.value = true
    activeTab.value = {
      ...tab(),
      domChangesRecording: {
        active: false,
        changeCount: 4,
        startedAt: '2026-08-21T11:59:00.000Z'
      }
    }
    await nextTick()

    expect(browser.manageDomChanges).toHaveBeenCalledTimes(1)
    first.resolve(domReport(false))
    await first.promise
    await nextTick()

    expect(controller.domChangesState.value).toBe('ready')
    expect(controller.domChangesReport.value).toEqual(domReport(false))
    controller.dispose()
  })

  it('restarts copied feedback when the same diagnostic report is copied again', async () => {
    vi.useFakeTimers()
    const { controller } = createController()
    controller.debugReport.value = {
      tabId: 'tab-1',
      url: 'https://example.test/app'
    } as BrowserDebugReport

    await controller.copyDebugReport()
    await vi.advanceTimersByTimeAsync(1_000)
    await controller.copyDebugReport()
    await vi.advanceTimersByTimeAsync(600)

    expect(controller.debugReportCopied.value).toBe(true)
    await vi.advanceTimersByTimeAsync(900)
    expect(controller.debugReportCopied.value).toBe(false)
    controller.dispose()
  })

  it.each(['debug', 'quality', 'issues'] as const)(
    'does not mark a refreshed %s report copied when an older clipboard write finishes',
    async (kind) => {
      const copying = deferred<boolean>()
      const { browser, controller, copyText } = createController()
      const report = { tabId: 'tab-1', url: 'https://example.test/app' }
      controller.debugReport.value = report as BrowserDebugReport
      controller.qualityAuditReport.value = report as BrowserQualityAudit
      controller.inspectorIssuesReport.value = report as BrowserInspectorIssuesReport
      browser.createDebugReport.mockResolvedValue({ ...report, title: 'Refreshed' })
      browser.runQualityAudit.mockResolvedValue({ ...report, title: 'Refreshed' })
      browser.listInspectorIssues.mockResolvedValue({ ...report, title: 'Refreshed' })
      const actions = {
        debug: { copy: controller.copyDebugReport, refresh: controller.runDebugReport, copied: controller.debugReportCopied },
        quality: { copy: controller.copyQualityAudit, refresh: controller.runQualityAudit, copied: controller.qualityAuditCopied },
        issues: { copy: controller.copyInspectorIssues, refresh: controller.refreshInspectorIssues, copied: controller.inspectorIssuesCopied }
      }[kind]
      copyText.mockImplementationOnce(() => copying.promise)

      const operation = actions.copy()
      await actions.refresh()
      copying.resolve(true)
      await operation

      expect(actions.copied.value).toBe(false)
      await actions.copy()
      expect(actions.copied.value).toBe(true)
      expect(copyText).toHaveBeenLastCalledWith(JSON.stringify({ ...report, title: 'Refreshed' }, null, 2), expect.any(Function))
      controller.dispose()
    }
  )

  it.each([
    ['coverage', 'success'], ['coverage', 'failure'], ['cpu', 'success'], ['cpu', 'failure']
  ] as const)('keeps %s stop %s authoritative during a recording-state refresh', async (domain, outcome) => {
    const pending = deferred<void>()
    const { activeTab, browser, controller } = createController()
    const coverage = domain === 'coverage'
    const api = coverage ? browser.manageCodeCoverage : browser.manageCpuProfile
    const manage = coverage ? controller.manageCodeCoverage : controller.manageCpuProfile
    const panel = coverage ? controller.coveragePanelOpen : controller.cpuProfilePanelOpen
    const state = coverage ? controller.coverageState : controller.cpuProfileState
    const error = coverage ? controller.coverageError : controller.cpuProfileError
    const result = coverage ? controller.coverageResult : controller.cpuProfileResult
    const completed = { tabId: 'tab-1', url: tab().url, title: 'Example', action: 'stop' as const, status: 'complete' as const }
    activeTab.value = {
      ...tab(),
      ...(coverage
        ? { codeCoverageRecording: { startedAt: '2026-08-21T12:00:00Z', mode: 'function' as const } }
        : { cpuProfileRecording: { startedAt: '2026-08-21T12:00:00Z' } })
    }
    await nextTick()
    panel.value = true
    result.value = { ...completed, status: 'recording' }
    api.mockImplementationOnce(async () => {
      await pending.promise
      if (outcome === 'failure') throw new Error('Profiler stop failed')
      return completed
    })
    api.mockResolvedValue({ ...completed, action: 'get', status: 'idle' })
    try {
      const stopping = manage('stop')
      activeTab.value = tab()
      await nextTick()
      await nextTick()
      expect(api).toHaveBeenCalledTimes(1)
      expect(state.value).toBe('loading')
      pending.resolve()
      await stopping
      if (outcome === 'failure') {
        expect(state.value).toBe('error')
        expect(error.value).toBe('Profiler stop failed')
      } else {
        expect(state.value).toBe('ready')
        expect(result.value).toEqual(completed)
      }
      await manage('get')
      expect(api).toHaveBeenCalledTimes(2)
      expect(state.value).toBe('ready')
      expect(result.value?.status).toBe('idle')
    } finally {
      pending.resolve()
      controller.dispose()
    }
  })

  it('keeps a recorder stop authoritative while tab updates request a refresh', async () => {
    const pending = deferred<BrowserReproRecording>()
    const { activeTab, browser, controller } = createController()
    const recording = { ...reproRecording(), active: true, stoppedAt: undefined }
    controller.reproPanelOpen.value = true
    controller.reproRecording.value = recording
    browser.manageRepro.mockImplementationOnce(() => pending.promise)
    browser.manageRepro.mockResolvedValue(recording)

    const stopping = controller.stopReproRecording()
    activeTab.value = { ...tab(), reproRecording: { active: true, stepCount: recording.stepCount, startedAt: '2026-08-21T12:00:00.000Z' } }
    await nextTick()
    await nextTick()

    expect(controller.reproState.value).toBe('loading')
    expect(browser.manageRepro).toHaveBeenCalledTimes(1)
    pending.resolve(reproRecording())
    await stopping
    expect(controller.reproState.value).toBe('ready')
    expect(controller.reproRecording.value?.active).toBe(false)
    controller.dispose()
  })

  it('shows recorder action failures despite an intervening refresh', async () => {
    const pending = deferred<void>()
    const { browser, controller } = createController()
    browser.manageRepro.mockImplementationOnce(async () => {
      await pending.promise
      throw new Error('Recording changed while stopping')
    })
    const stopping = controller.stopReproRecording()
    await controller.manageRepro('get')
    pending.resolve()
    await stopping

    expect(controller.reproState.value).toBe('error')
    expect(controller.reproError.value).toBe('Recording changed while stopping')
    browser.manageRepro.mockResolvedValue(reproRecording())
    await controller.manageRepro('get')
    expect(controller.reproState.value).toBe('ready')
    controller.dispose()
  })

  it('allows a new page refresh while an obsolete recorder action is pending', async () => {
    const pending = deferred<BrowserReproRecording>()
    const { activeTab, browser, controller } = createController()
    browser.manageRepro.mockImplementationOnce(() => pending.promise)
    const stopping = controller.stopReproRecording()
    activeTab.value = { ...tab(), navigationGeneration: 1 }
    await nextTick()
    const replacement = { ...reproRecording(), active: true, stoppedAt: undefined }
    browser.manageRepro.mockResolvedValue(replacement)
    await controller.manageRepro('get')
    expect(controller.reproRecording.value?.active).toBe(true)

    pending.resolve(reproRecording())
    await stopping
    expect(controller.reproRecording.value?.active).toBe(true)
    controller.dispose()
  })

  it.each(['start', 'stop', 'clear', 'get'] as const)(
    'invalidates pending recording exports only for mutations: %s',
    async (action) => {
      const copying = deferred<boolean>()
      const { browser, controller, copyText } = createController()
      const recording = reproRecording()
      controller.reproRecording.value = recording
      browser.manageRepro.mockResolvedValueOnce(recording)
      copyText.mockImplementation(() => copying.promise)

      const jsonCopy = controller.copyReproRecording()
      const playwrightCopy = controller.copyReproPlaywright()
      await controller.manageRepro(action)
      copying.resolve(true)
      await Promise.all([jsonCopy, playwrightCopy])

      expect(controller.reproCopied.value).toBe(action === 'get')
      expect(controller.reproPlaywrightCopied.value).toBe(action === 'get')
      controller.dispose()
    }
  )

  it.each(['start', 'stop', 'clear', 'get'] as const)(
    'invalidates pending DOM recording exports only for mutations: %s',
    async (action) => {
      const copying = deferred<boolean>()
      const { browser, controller, copyText } = createController()
      controller.domChangesReport.value = domReport()
      browser.manageDomChanges.mockResolvedValueOnce(domReport(action === 'start'))
      copyText.mockImplementationOnce(() => copying.promise)

      const operation = controller.copyDomChanges()
      await controller.manageDomChanges(action)
      copying.resolve(true)
      await operation

      expect(controller.domChangesCopied.value).toBe(action === 'get')
      // The new recording remains exportable after a mutation.
      await controller.copyDomChanges()
      expect(controller.domChangesCopied.value).toBe(true)
      controller.dispose()
    }
  )

  it('keeps repro copy feedback during a read-only recording refresh', async () => {
    vi.useFakeTimers()
    const { browser, controller } = createController()
    const recording = reproRecording()
    controller.reproRecording.value = recording
    browser.manageRepro.mockResolvedValueOnce(recording)

    await controller.copyReproRecording()
    expect(controller.reproCopied.value).toBe(true)
    await controller.manageRepro('get')

    expect(controller.reproCopied.value).toBe(true)
    controller.dispose()
  })

  it('does not show copied feedback after the diagnostic page changes during clipboard write', async () => {
    const copying = deferred<boolean>()
    const { activeTab, controller, copyText } = createController()
    controller.debugReport.value = {
      tabId: 'tab-1',
      url: 'https://example.test/app'
    } as BrowserDebugReport
    copyText.mockImplementationOnce(() => copying.promise)

    const operation = controller.copyDebugReport()
    activeTab.value = { ...tab(), url: 'https://example.test/next' }
    await nextTick()
    copying.resolve(true)
    await operation

    expect(controller.debugReportCopied.value).toBe(false)
    controller.dispose()
  })
})


describe('diagnostic text-copy failure ownership', () => {
  function prepareFailure(kind: typeof textCopyKinds[number]) {
    const pending = deferred<void>()
    const showToast = vi.fn()
    const nativeCopy = vi.fn(async (_text: string): Promise<void> => {}).mockReturnValueOnce(pending.promise)
    const shell = useShellFeedbackController({ browser: { copyText: nativeCopy }, translate: key => key, showToast })
    return { ...prepareTextCopy(kind, shell.copyText), pending, showToast, nativeCopy }
  }

  it.each(textCopyKinds.flatMap(kind =>
    (['newer', 'reset', 'dispose', 'tab', 'url', 'navigation'] as const).map(action => ({ kind, action }))
  ))('suppresses obsolete $kind failure toasts after $action', async ({ kind, action }) => {
    const h = prepareFailure(kind)
    try {
      const copying = h.copy()
      expect(h.nativeCopy).toHaveBeenCalledOnce()
      if (action === 'newer') await h.copy()
      else if (action === 'reset') h.controller.resetForContext()
      else if (action === 'dispose') h.controller.dispose()
      else {
        if (action === 'tab') h.activeTab.value = tab('tab-2')
        else if (action === 'url') h.activeTab.value = { ...tab(), url: 'https://example.test/other' }
        else h.activeTab.value = { ...tab(), navigationGeneration: 1 }
        await nextTick()
        // Returning to the same visible context must not revive the old operation.
        h.activeTab.value = tab()
        await nextTick()
      }
      h.pending.reject(new Error('Obsolete diagnostic clipboard refusal'))
      await copying
      expect(h.showToast).not.toHaveBeenCalled()
      expect(h.copied.value).toBe(action === 'newer')
    } finally { h.controller.dispose() }
  })

  it.each(['debug', 'issues', 'quality'] as const)('suppresses an obsolete %s failure after refreshing its report', async kind => {
    const h = prepareFailure(kind)
    const report = { tabId: 'tab-1', url: 'https://example.test/app', title: 'Refreshed' }
    h.browser.createDebugReport.mockResolvedValue(report)
    h.browser.runQualityAudit.mockResolvedValue(report)
    h.browser.listInspectorIssues.mockResolvedValue(report)
    try {
      const copying = h.copy()
      await { debug: h.controller.runDebugReport, issues: h.controller.refreshInspectorIssues, quality: h.controller.runQualityAudit }[kind]()
      h.pending.reject(new Error('Obsolete refreshed diagnostic clipboard refusal'))
      await copying
      expect(h.showToast).not.toHaveBeenCalled()
      expect(h.copied.value).toBe(false)
    } finally { h.controller.dispose() }
  })

  it.each((['repro', 'playwright', 'dom'] as const).flatMap(kind =>
    (['start', 'stop', 'clear', 'get'] as const).map(action => ({ kind, action }))
  ))('keeps $kind failure ownership for reads but invalidates mutations: $action', async ({ kind, action }) => {
    const h = prepareFailure(kind)
    h.browser.manageRepro.mockResolvedValue(reproRecording())
    h.browser.manageDomChanges.mockResolvedValue(domReport())
    try {
      const copying = h.copy()
      if (kind === 'dom') await h.controller.manageDomChanges(action)
      else await h.controller.manageRepro(action)
      h.pending.reject(new Error('Recorder clipboard refusal'))
      await copying
      if (action === 'get') expect(h.showToast).toHaveBeenCalledExactlyOnceWith('error', 'runtime.capture.copyFailed', 'Recorder clipboard refusal')
      else expect(h.showToast).not.toHaveBeenCalled()
      expect(h.copied.value).toBe(false)
    } finally { h.controller.dispose() }
  })

  it.each(textCopyKinds)('keeps current %s failures visible', async kind => {
    const h = prepareFailure(kind)
    try {
      const copying = h.copy()
      h.pending.reject(new Error('Current diagnostic clipboard refusal'))
      await copying
      expect(h.showToast).toHaveBeenCalledExactlyOnceWith('error', 'runtime.capture.copyFailed', 'Current diagnostic clipboard refusal')
      expect(h.copied.value).toBe(false)
    } finally { h.controller.dispose() }
  })
})
