import { render, screen, within } from '@testing-library/vue'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DiagnosticsPanels from '../../src/renderer/src/features/diagnostics/DiagnosticsPanels.vue'
import { useDiagnosticsController } from '../../src/renderer/src/features/diagnostics/useDiagnosticsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type {
  BrowserAccessibilityAudit,
  BrowserDebugReport,
  BrowserPerformanceReport,
  BrowserSecurityReport,
  BrowserTabState
} from '../../src/shared/types.js'

type DiagnosticsBrowser = Parameters<typeof useDiagnosticsController>[0]['browser']

const tab = {
  id: 'tab-1', title: 'Example', url: 'https://example.test/app', loading: false, navigationGeneration: 0,
  canGoBack: false, canGoForward: false, active: true, pinned: false, sleeping: false, humanInteractionLocked: false,
  preserveDiagnosticLogs: false, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false
} satisfies BrowserTabState

function performanceReport(): BrowserPerformanceReport {
  return {
    tabId: 'tab-1', url: 'https://example.test/app', title: 'Example',
    measuredAt: '2026-08-21T12:00:00.000Z', observedAt: '2026-08-21T12:00:00.000Z', scope: 'current-visit',
    engine: { name: 'web-vitals', version: '6.1.0' }, action: 'measure',
    metrics: {
      LCP: { name: 'LCP', value: 3_100, unit: 'ms', rating: 'needs-improvement', navigationType: 'navigate', targets: [] },
      INP: { name: 'INP', value: 600, unit: 'ms', rating: 'poor', navigationType: 'navigate', targets: [] },
      CLS: { name: 'CLS', value: 0.01, unit: 'score', rating: 'good', navigationType: 'navigate', targets: [] },
      FCP: null, TTFB: null
    },
    navigation: null,
    resources: { count: 0, transferBytes: 0, encodedBodyBytes: 0, decodedBodyBytes: 0, byType: [] },
    longTasks: { supported: true, count: 0, totalDurationMs: 0, blockingTimeMs: 0, longestDurationMs: 0 },
    longAnimationFrames: {
      supported: true, count: 1, totalDurationMs: 120, blockingDurationMs: 70, longestDurationMs: 120,
      renderDurationMs: 10, styleAndLayoutDurationMs: 5, frames: [],
      contributors: [
        { invokerType: 'event-listener', count: 1, totalDurationMs: 90, forcedStyleAndLayoutDurationMs: 0 },
        { invokerType: 'future-invoker', count: 1, totalDurationMs: 30, forcedStyleAndLayoutDurationMs: 0 }
      ],
      truncated: false
    },
    userTimings: {
      count: 2,
      entries: [
        { type: 'mark', name: 'app:start', startTimeMs: 10, durationMs: 0 },
        { type: 'measure', name: 'app:boot', startTimeMs: 12, durationMs: 40 }
      ],
      truncated: false
    },
    layoutShifts: { supported: true, count: 0, scoreSum: 0, recentInputCount: 0, entries: [], truncated: false },
    caveats: []
  }
}

function accessibilityAudit(): BrowserAccessibilityAudit {
  return {
    tabId: 'tab-1', url: 'https://example.test/app', title: 'Example', auditedAt: '2026-09-15T10:05:00.000Z',
    action: 'measure', standard: 'wcag-aa', scope: { selector: null, maxViolations: 50, maxNodesPerViolation: 3 },
    engine: { name: 'axe-core', version: '4.13.0' },
    violationCount: 2, affectedNodeCount: 2, needsReviewCount: 0, passedRuleCount: 20, truncated: false,
    violations: [
      {
        id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds',
        helpUrl: '', description: 'Ensure contrast', nodeCount: 1, nodes: [{ targets: ['#lead'], failureSummary: 'Fix contrast' }]
      },
      {
        id: 'region', impact: 'moderate', help: 'All page content should be contained by landmarks',
        helpUrl: '', description: 'Ensure landmarks', nodeCount: 1, nodes: [{ targets: ['#aside'], failureSummary: 'Add a landmark' }]
      }
    ]
  }
}

function securityReport(state: BrowserSecurityReport['state']): BrowserSecurityReport {
  return {
    tabId: 'tab-1', url: 'https://example.test/app', origin: 'https://example.test', title: 'Example',
    checkedAt: '2026-09-15T10:05:00.000Z', state, secureTransport: true,
    connection: { protocol: 'TLS 1.3', cipher: 'AES_128_GCM', keyExchangeGroup: 'X25519', certificateTransparencyCompliance: 'not-compliant', encryptedClientHello: false },
    caveats: []
  }
}

function debugReport(): BrowserDebugReport {
  return {
    generatedAt: '2026-09-15T10:05:00.000Z', tabId: 'tab-1', title: 'Example', url: 'https://example.test/app', networkRouteCount: 0,
    summary: { consoleMessages: 2, consoleWarnings: 1, consoleErrors: 1, networkRequests: 1, failedRequests: 1, pendingRequests: 0, cachedRequests: 0, responseBytes: 0 },
    console: [
      { timestamp: '2026-09-15T10:04:00.000Z', level: 'error', message: 'fixture failure', lineNumber: 0, sourceId: '' },
      { timestamp: '2026-09-15T10:04:01.000Z', level: 'warning', message: 'fixture warning', lineNumber: 0, sourceId: '' }
    ],
    network: [{ id: 'blocked', url: 'https://example.test/blocked.js', method: 'GET', resourceType: 'script', startedAt: '2026-09-15T10:04:02.000Z', error: 'net::ERR_FAILED', detailsAvailable: false, issue: true }],
    truncated: { console: false, network: false },
    caveats: []
  }
}

function renderGermanPanels(overrides: Partial<DiagnosticsBrowser>) {
  const browser: DiagnosticsBrowser = {
    measurePerformance: vi.fn(), inspectDesign: vi.fn(), inspectPageMetadata: vi.fn(), inspectSecurity: vi.fn(),
    manageCodeCoverage: vi.fn(), manageCpuProfile: vi.fn(), measureMemory: vi.fn(), createDebugReport: vi.fn(),
    manageRepro: vi.fn(), manageDomChanges: vi.fn(), visualCompare: vi.fn(), copyVisualDiff: vi.fn(),
    listInspectorIssues: vi.fn(), runAccessibilityAudit: vi.fn(), runQualityAudit: vi.fn(),
    ...overrides
  }
  const controller = useDiagnosticsController({
    activeTab: ref<BrowserTabState | undefined>(tab),
    browser,
    translate: key => key,
    copyText: async () => true,
    closeTransientPanels: vi.fn(),
    keepsSeparatePanelOpen: () => false
  })
  const view = render(DiagnosticsPanels, {
    global: { plugins: [createHronautI18n('de-DE')] },
    props: {
      dock: 'right', activeTab: tab, locale: 'de-DE', controller,
      openSupport: vi.fn(async () => undefined), preservationBusy: false, updatePreservation: vi.fn(), keepsSeparatePanelOpen: () => false
    }
  })
  return { controller, view }
}

beforeEach(() => {
  vi.stubGlobal('hronaut', { discardIncident: vi.fn(async () => undefined), invalidateIncidentPreview: vi.fn(async () => undefined) })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('audit ratings and states in the interface language', () => {
  it('rates Web Vitals and names script invokers and user timings in German', async () => {
    const { controller, view } = renderGermanPanels({ measurePerformance: vi.fn(async () => performanceReport()) })
    await controller.runPerformanceReport()
    const panel = screen.getByRole('dialog', { name: 'Seitenleistung' })

    const vitals = panel.querySelector('.performance-vitals')!
    expect(vitals).toHaveTextContent('LCPverbesserungswürdig')
    expect(vitals).toHaveTextContent('INPschlecht')
    expect(vitals).toHaveTextContent('CLSgut')
    expect(panel).toHaveTextContent('Event-Listener')
    expect(panel).toHaveTextContent('future-invoker')
    expect(panel).not.toHaveTextContent('needs improvement')
    expect(panel).not.toHaveTextContent('event-listener')
    const timings = panel.querySelector('.performance-user-timings')!
    expect(within(timings as HTMLElement).getByText('app:start').closest('li')).toHaveTextContent('Marke ·')
    expect(within(timings as HTMLElement).getByText('app:boot').closest('li')).toHaveTextContent('Messung ·')
    view.unmount()
    controller.dispose()
  })

  it('names each violation impact and the audited standard in German', async () => {
    const { controller, view } = renderGermanPanels({ runAccessibilityAudit: vi.fn(async () => accessibilityAudit()) })
    await controller.runAccessibilityAudit()
    const panel = screen.getByRole('dialog', { name: 'Barrierefreiheit' })

    const impacts = [...panel.querySelectorAll('.accessibility-impact')].map((badge) => badge.textContent)
    expect(impacts).toEqual(['schwerwiegend', 'mittel'])
    expect(panel.querySelector('footer')).toHaveTextContent('axe-core 4.13.0 · WCAG A und AA')
    view.unmount()
    controller.dispose()
  })

  it('names the connection security state and certificate transparency in German', async () => {
    const inspectSecurity = vi.fn(async () => securityReport('neutral'))
    const { controller, view } = renderGermanPanels({ inspectSecurity })
    await controller.runSecurityReport()
    const panel = screen.getByRole('dialog', { name: 'Verbindungssicherheit' })
    expect(panel.querySelector('.security-state')).toHaveTextContent('neutral')
    expect(panel).toHaveTextContent('Nicht konform')
    expect(panel).not.toHaveTextContent('not-compliant')

    inspectSecurity.mockResolvedValueOnce(securityReport('secure'))
    await controller.runSecurityReport()
    expect(panel.querySelector('.security-state')).toHaveTextContent('sicher')
    inspectSecurity.mockResolvedValueOnce(securityReport('unknown'))
    await controller.runSecurityReport()
    expect(panel.querySelector('.security-overview strong')).toHaveTextContent('Verbindungssicherheit: unbekannt')
    expect(panel.querySelector('.security-state')).toHaveTextContent('unbekannt')
    view.unmount()
    controller.dispose()
  })

  it('names console levels and request types in the German debug report', async () => {
    const { controller, view } = renderGermanPanels({ createDebugReport: vi.fn(async () => debugReport()) })
    await controller.runDebugReport()
    const panel = screen.getByRole('dialog', { name: 'Debugbericht' })

    const levels = [...panel.querySelectorAll('.debug-console-entry header span')].map((level) => level.textContent)
    expect(levels).toEqual(['Fehler', 'Warnung'])
    expect(panel.querySelector('.debug-network-entry small')).toHaveTextContent('Skript')
    expect(panel.querySelector('.debug-network-entry small')).not.toHaveTextContent('script')
    view.unmount()
    controller.dispose()
  })
})
