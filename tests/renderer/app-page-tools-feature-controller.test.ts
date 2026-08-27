import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  useAppPageToolsFeatureController,
  type AppPageToolsFeatureControllerOptions
} from '../../src/renderer/src/composables/useAppPageToolsFeatureController.js'
import type { BrowserTabState } from '../../src/shared/types.js'

function tab(): BrowserTabState {
  return {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/app'
  } as BrowserTabState
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function createFeature() {
  const area = deferred<{ canceled: boolean; copied: boolean }>()
  const pdf = deferred<{ filename: string; path: string; bytes: number }>()
  const performance = deferred<never>()
  const browser = {
    pickElement: vi.fn(),
    captureElement: vi.fn(),
    cancelElementPicker: vi.fn(async () => true),
    captureArea: vi.fn(() => area.promise),
    cancelAreaCapture: vi.fn(async () => true),
    capturePage: vi.fn(),
    copySnapshot: vi.fn(),
    savePdf: vi.fn(() => pdf.promise),
    measurePerformance: vi.fn(() => performance.promise),
    inspectDesign: vi.fn(),
    inspectPageMetadata: vi.fn(),
    inspectSecurity: vi.fn(),
    manageCodeCoverage: vi.fn(),
    manageCpuProfile: vi.fn(),
    measureMemory: vi.fn(),
    createDebugReport: vi.fn(),
    manageRepro: vi.fn(),
    manageDomChanges: vi.fn(),
    visualCompare: vi.fn(),
    copyVisualDiff: vi.fn(),
    listInspectorIssues: vi.fn(),
    runAccessibilityAudit: vi.fn(),
    runQualityAudit: vi.fn()
  }
  const showToast = vi.fn()
  const options = {
    activeTab: ref<BrowserTabState | undefined>(tab()),
    browser,
    emulation: { activeEmulation: ref(undefined) },
    environmentState: ref<'idle' | 'applying' | 'applied' | 'error'>('idle'),
    environmentOverrideCount: ref(0),
    copyText: vi.fn(async () => true),
    closeTransientPanels: vi.fn(),
    keepsSeparatePanelOpen: () => false,
    translate: (key: string) => key,
    formatNumber: (value: number) => String(value),
    formatPercent: (value: number) => `${value}%`,
    formatBytes: (value: number) => `${value} B`,
    showToast
  } as unknown as AppPageToolsFeatureControllerOptions
  const feature = useAppPageToolsFeatureController(options)
  return { area, pdf, performance, browser, feature, showToast }
}

describe('app page tools feature controller', () => {
  it('preserves child-controller identities and public ref aliases', () => {
    const { feature } = createFeature()

    expect(feature.elementPickerState).toBe(feature.pageCaptureController.elementState)
    expect(feature.areaCaptureState).toBe(feature.pageCaptureController.captureState)
    expect(feature.pageSnapshotState).toBe(feature.pageExportController.snapshotState)
    expect(feature.pdfExportState).toBe(feature.pageExportController.pdfState)
    expect(feature.accessibilityPanelOpen).toBe(feature.diagnosticsController.accessibilityPanelOpen)
    expect(feature.pageToolsLabels).toBe(feature.pageToolsPresentationController.labels)

    feature.dispose()
  })

  it('disposes pending capture, export, and diagnostic work as one boundary', async () => {
    const { area, pdf, performance, browser, feature, showToast } = createFeature()

    const capturing = feature.toggleAreaCapture()
    const exporting = feature.saveActivePdf()
    const measuring = feature.diagnosticsController.runPerformanceReport()
    feature.dispose()
    feature.dispose()

    expect(browser.cancelAreaCapture).toHaveBeenCalledTimes(1)
    expect(browser.cancelAreaCapture).toHaveBeenCalledWith('tab-1')
    expect(feature.areaCaptureState.value).toBe('idle')
    expect(feature.pdfExportState.value).toBe('idle')

    area.resolve({ canceled: false, copied: true })
    pdf.resolve({ filename: 'stale.pdf', path: '/tmp/stale.pdf', bytes: 42 })
    performance.reject(new Error('stale measurement'))
    await Promise.all([capturing, exporting, measuring])

    expect(feature.diagnosticsController.performanceReport.value).toBeNull()
    expect(showToast).not.toHaveBeenCalled()
  })
})
