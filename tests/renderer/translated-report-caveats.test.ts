import { render, screen } from '@testing-library/vue'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SiteStorageIndexedDbView from '../../src/renderer/src/components/SiteStorageIndexedDbView.vue'
import DiagnosticsPanels from '../../src/renderer/src/features/diagnostics/DiagnosticsPanels.vue'
import { useDiagnosticsController } from '../../src/renderer/src/features/diagnostics/useDiagnosticsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { ACCESSIBILITY_COMPARISON_CAVEATS } from '../../src/shared/accessibility-comparison.js'
import { INDEXEDDB_CAVEATS } from '../../src/shared/indexeddb.js'
import { reportCaveatMessages } from '../../src/shared/locales/report-caveats.js'
import { PERFORMANCE_COMPARISON_CAVEATS, PERFORMANCE_REPORT_CAVEATS } from '../../src/shared/performance-audit.js'
import type {
  BrowserAccessibilityAudit,
  BrowserIndexedDbReport,
  BrowserPerformanceReport,
  BrowserTabState,
  SupportedLocale
} from '../../src/shared/types.js'

// Page performance, the accessibility comparison and the IndexedDB inspector listed their reports' English caveats in
// every language, and the IndexedDB inspector told the person reading it to "Use browser_site_data".

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
    violationCount: 3, affectedNodeCount: 3, needsReviewCount: 0, passedRuleCount: 20, truncated: false,
    violations: [
      {
        id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds',
        helpUrl: '', description: 'Ensure contrast', nodeCount: 1, nodes: [{ targets: ['#lead'], failureSummary: 'Fix contrast' }]
      },
      {
        id: 'region', impact: 'moderate', help: 'All page content should be contained by landmarks',
        helpUrl: '', description: 'Ensure landmarks', nodeCount: 1, nodes: [{ targets: ['#aside'], failureSummary: 'Add a landmark' }]
      },
      {
        id: 'future-rule', impact: 'unknown', help: 'A rule without an impact',
        helpUrl: '', description: 'Ensure something', nodeCount: 1, nodes: [{ targets: ['#footer'], failureSummary: 'Fix it' }]
      }
    ]
  }
}

let mounted: { unmount: () => void, dispose: () => void } | undefined

function renderPanels(locale: SupportedLocale, overrides: Partial<DiagnosticsBrowser>) {
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
    global: { plugins: [createHronautI18n(locale)] },
    props: {
      dock: 'right', activeTab: tab, locale, controller,
      openSupport: vi.fn(async () => undefined), preservationBusy: false, updatePreservation: vi.fn(), keepsSeparatePanelOpen: () => false
    }
  })
  mounted = { unmount: () => view.unmount(), dispose: () => controller.dispose() }
  return { controller }
}

beforeEach(() => {
  vi.stubGlobal('hronaut', { discardIncident: vi.fn(async () => undefined), invalidateIncidentPreview: vi.fn(async () => undefined) })
})
afterEach(() => {
  // Unmount before un-stubbing: the debug report's incident review calls the stubbed bridge as it closes.
  mounted?.unmount()
  mounted?.dispose()
  mounted = undefined
  vi.unstubAllGlobals()
})

function caveats(panel: HTMLElement, selector: string): string[] {
  return [...panel.querySelectorAll(selector)].map((item) => item.textContent?.trim() ?? '')
}

const performanceCaveats = [...Object.values(PERFORMANCE_REPORT_CAVEATS), PERFORMANCE_COMPARISON_CAVEATS.deltas, 'A future caveat.']
const comparisonCaveats = [ACCESSIBILITY_COMPARISON_CAVEATS.urlChanged, ACCESSIBILITY_COMPARISON_CAVEATS.baselineTruncated, 'A future caveat.']

function comparedAudit(): BrowserAccessibilityAudit {
  const audit = accessibilityAudit()
  return {
    ...audit,
    baseline: { auditedAt: '2026-09-15T10:00:00.000Z', url: 'https://example.test/old', standard: 'wcag-aa', scope: audit.scope, engine: audit.engine, violationCount: 2, visibleFindingCount: 2, truncated: true },
    comparison: { comparable: true, sameUrl: false, sameScope: true, sameEngine: true, newFindings: null, remainingFindings: [], resolvedFindings: [], caveats: comparisonCaveats }
  }
}

function indexedDbView(locale: SupportedLocale, reportCaveats: string[]) {
  const report: BrowserIndexedDbReport = {
    tabId: 'tab-1', url: 'https://example.test', origin: 'https://example.test',
    databases: [{ name: 'app', version: 1 }],
    selectedDatabase: { name: 'app', version: 1, objectStores: [{ name: 'settings', keyPath: 'id', autoIncrement: false, indexes: [], entryCount: 1 }] },
    selectedObjectStore: 'settings', offset: 0, limit: 50, hasMore: false, valuesIncluded: true, caveats: reportCaveats,
    entries: [{ key: 'theme', primaryKey: 'theme', keyType: 'String', valueType: 'Object', valuePreview: 'dark' }]
  }
  const view = render(SiteStorageIndexedDbView, {
    global: { plugins: [createHronautI18n(locale)] },
    props: { state: 'idle', report, error: '', copied: false, entries: report.entries, offset: 0, locale, database: 'app', store: 'settings', search: '' }
  })
  try { return caveats(view.container as HTMLElement, '.indexeddb-caveats li') } finally { view.unmount() }
}

describe('report caveats in the interface language', () => {
  it('lists Page performance caveats in German and as recorded in English', async () => {
    const report = { ...performanceReport(), caveats: performanceCaveats } satisfies BrowserPerformanceReport
    const german = renderPanels('de-DE', { measurePerformance: vi.fn(async () => report) })
    await german.controller.runPerformanceReport()
    const shown = caveats(screen.getByRole('dialog', { name: 'Seitenleistung' }), 'details li')
    expect(shown).toHaveLength(9)
    expect(shown[1]).toBe('Dies ist eine einzelne lokale Stichprobe des aktuellen Besuchs, keine Felddaten und kein CrUX-Ergebnis zum 75. Perzentil.')
    expect(shown[7]).toMatch(/^Vorher-nachher-Differenzen vergleichen zwei lokale Stichproben/)
    expect(shown[8]).toBe('A future caveat.')
    for (const caveat of performanceCaveats.slice(0, -1)) expect(shown).not.toContain(caveat)
    mounted?.unmount(); mounted?.dispose(); mounted = undefined

    const english = renderPanels('en-US', { measurePerformance: vi.fn(async () => report) })
    await english.controller.runPerformanceReport()
    expect(caveats(screen.getByRole('dialog', { name: 'Page performance' }), 'details li')).toEqual(performanceCaveats)
  })

  it('lists the accessibility comparison caveats in German and as recorded in English', async () => {
    const german = renderPanels('de-DE', { runAccessibilityAudit: vi.fn(async () => comparedAudit()) })
    await german.controller.runAccessibilityAudit()
    expect(caveats(screen.getByRole('dialog', { name: 'Barrierefreiheit' }), '.accessibility-comparison-caveats li')).toEqual([
      'Die Seitenadresse hat sich seit der Baseline geändert.',
      'Die Baseline wurde gekürzt, daher lassen sich neue Befunde nicht sicher bestimmen.',
      'A future caveat.'
    ])
    mounted?.unmount(); mounted?.dispose(); mounted = undefined

    const english = renderPanels('en-US', { runAccessibilityAudit: vi.fn(async () => comparedAudit()) })
    await english.controller.runAccessibilityAudit()
    expect(caveats(screen.getByRole('dialog', { name: 'Accessibility' }), '.accessibility-comparison-caveats li')).toEqual(comparisonCaveats)
  })

  it('words the IndexedDB caveats for the person reading the inspector', () => {
    const recorded = [INDEXEDDB_CAVEATS.origin, INDEXEDDB_CAVEATS.snapshot, INDEXEDDB_CAVEATS.names, INDEXEDDB_CAVEATS.longNames, INDEXEDDB_CAVEATS.valuesIncluded, INDEXEDDB_CAVEATS.readOnly, 'A future caveat.']
    const english = indexedDbView('en-US', recorded)
    expect(english).toContain('This inspector only reads IndexedDB and never changes or clears it.')
    expect(english.join(' ')).not.toMatch(/browser_site_data|includeValues|the task/)
    expect(english.at(-1)).toBe('A future caveat.')
    expect(indexedDbView('de-DE', recorded)).toEqual([
      ...['origin', 'snapshot', 'names', 'longNames', 'valuesIncluded', 'readOnly'].map((key) => reportCaveatMessages['de-DE'].indexedDb[key as keyof typeof INDEXEDDB_CAVEATS]),
      'A future caveat.'
    ])
  })

  it('keeps the English performance and comparison caveats as the reports record them', () => {
    expect(reportCaveatMessages['en-US'].performance).toEqual({ ...PERFORMANCE_REPORT_CAVEATS, ...PERFORMANCE_COMPARISON_CAVEATS })
    expect(reportCaveatMessages['en-US'].accessibilityComparison).toEqual(ACCESSIBILITY_COMPARISON_CAVEATS)
    expect(Object.keys(reportCaveatMessages['en-US'].indexedDb)).toEqual(Object.keys(INDEXEDDB_CAVEATS))
  })

  it('keeps the English caveats MCP results return, word for word and in order', () => {
    // Agents read these through browser_performance, browser_accessibility_audit and browser_indexeddb.
    expect(Object.values(PERFORMANCE_REPORT_CAVEATS)).toEqual([
      'LCP phases are browser-timing observations, not causal proof. Missing or restricted evidence is explicit; restoration and soft-navigation phase attribution are unsupported.',
      'This is one local current-visit sample, not field data or a 75th-percentile CrUX result.',
      'INP is unavailable until the page receives a qualifying interaction; some metrics are unavailable for background or short-lived visits.',
      'Long animation frame attribution identifies script entry points rather than necessarily the slowest internal function.',
      'Cross-origin frames, workers, service workers, and isolated-world code may contribute work without script attribution.',
      'User Timing names are page-authored and sanitized; arbitrary detail objects, stack traces, and source code are omitted.',
      'Layout-shift evidence excludes entries with recent discrete input. Its score sum is diagnostic and may differ from CLS session-window scoring.'
    ])
    expect(Object.values(PERFORMANCE_COMPARISON_CAVEATS)).toEqual([
      'The baseline URL differs from this measurement; compare only if the navigation change was intentional.',
      'The browser environment differs from the baseline; viewport, throttling, cache, headers, or locale changes can affect the delta.',
      'Before-and-after deltas compare two local samples and may include normal run-to-run variation; repeat important measurements under matching conditions.'
    ])
    expect(Object.values(ACCESSIBILITY_COMPARISON_CAVEATS)).toEqual([
      'The page URL changed after the accessibility baseline.',
      'The accessibility standard, selector, or collection limits changed; set a new baseline for this scope.',
      'The accessibility engine changed; set a new baseline before comparing findings.',
      'The baseline was truncated, so new findings cannot be determined safely.',
      'The current audit was truncated, so resolved findings cannot be determined safely.'
    ])
    expect(Object.values(INDEXEDDB_CAVEATS)).toEqual([
      'The report covers this top-level origin only; third-party frame databases are not included.',
      'Database and record lists are point-in-time snapshots. Refresh after the website changes IndexedDB.',
      'Database, object-store, index, and key names are website-authored and can themselves contain private data.',
      'Database or object-store names longer than 512 characters are omitted from this bounded inspector.',
      'Bounded record previews are included and may contain private application data.',
      'Record values are omitted. Request includeValues only when their bounded previews are necessary and safe to return.',
      'The inspector is read-only. Use browser_site_data only when the task explicitly requires clearing origin storage.'
    ])
  })
})
