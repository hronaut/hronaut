import { nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDiagnosticsController } from '../../src/renderer/src/composables/useDiagnosticsController.js'
import type {
  BrowserDebugReport,
  BrowserDomChangesReport,
  BrowserPerformanceReport,
  BrowserReproRecording,
  BrowserTabState
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
  const promise = new Promise<Value>((next) => (resolve = next))
  return { promise, resolve }
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

function createController() {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const copyText = vi.fn(async () => true)
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

afterEach(() => {
  vi.useRealTimers()
})

describe('diagnostics controller', () => {
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
