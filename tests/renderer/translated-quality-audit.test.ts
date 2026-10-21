import { cleanup, render, screen } from '@testing-library/vue'
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QualityAuditPanel from '../../src/renderer/src/features/diagnostics/quality-audit/QualityAuditPanel.vue'
import { useDiagnosticsController } from '../../src/renderer/src/features/diagnostics/useDiagnosticsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { buildBrowserQualityAudit, type BrowserQualityAuditSources } from '../../src/shared/quality-audit.js'
import type { BrowserQualityAudit, BrowserTabState, SupportedLocale } from '../../src/shared/types.js'

// The quality audit showed every category, summary, evidence line, finding and caveat in English, whatever the
// interface language.

type DiagnosticsBrowser = Parameters<typeof useDiagnosticsController>[0]['browser']

const disposers: Array<() => void> = []
afterEach(() => {
  cleanup()
  for (const dispose of disposers.splice(0)) dispose()
})

function sources(): BrowserQualityAuditSources {
  return {
    accessibility: {
      tabId: 'tab-1',
      url: 'https://example.test/',
      title: 'Example',
      auditedAt: '2026-08-17T00:00:00.000Z',
      action: 'measure',
      standard: 'wcag-aa',
      scope: { selector: null, maxViolations: 50, maxNodesPerViolation: 1 },
      engine: { name: 'axe-core', version: '4.10.0' },
      violationCount: 0,
      affectedNodeCount: 0,
      needsReviewCount: 0,
      passedRuleCount: 20,
      truncated: false,
      violations: []
    },
    performance: {
      tabId: 'tab-1',
      url: 'https://example.test/',
      title: 'Example',
      measuredAt: '2026-08-17T00:00:00.000Z',
      observedAt: '2026-08-17T00:00:00.000Z',
      scope: 'current-visit',
      engine: { name: 'web-vitals', version: '5.1.0' },
      metrics: {
        LCP: { name: 'LCP', value: 1_200, unit: 'ms', rating: 'good', navigationType: 'navigate', targets: [] },
        INP: { name: 'INP', value: 80, unit: 'ms', rating: 'good', navigationType: 'navigate', targets: [] },
        CLS: { name: 'CLS', value: 0.02, unit: 'score', rating: 'good', navigationType: 'navigate', targets: [] },
        FCP: { name: 'FCP', value: 900, unit: 'ms', rating: 'good', navigationType: 'navigate', targets: [] },
        TTFB: { name: 'TTFB', value: 300, unit: 'ms', rating: 'good', navigationType: 'navigate', targets: [] }
      },
      navigation: null,
      resources: { count: 4, transferBytes: 1_024, encodedBodyBytes: 2_048, decodedBodyBytes: 4_096, byType: [] },
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
    },
    metadata: {
      tabId: 'tab-1',
      url: 'https://example.test/',
      title: 'Example',
      capturedAt: '2026-08-17T00:00:00.000Z',
      document: {
        language: 'en',
        charset: 'UTF-8',
        viewport: 'width=device-width',
        description: 'Example description',
        robots: 'index,follow',
        themeColor: null,
        manifestUrl: null,
        titleElementCount: 1,
        descriptionCount: 1,
        canonicalUrls: ['https://example.test/'],
        headingCounts: { h1: 1, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 }
      },
      openGraph: { title: null, type: null, url: null, description: null, siteName: null, locale: null, images: [], propertyCount: 0 },
      twitter: { card: null, title: null, description: null, site: null, creator: null, images: [], propertyCount: 0 },
      alternateLinks: [],
      icons: [],
      structuredData: { blockCount: 0, validBlockCount: 0, invalidBlockCount: 0, types: [], blocks: [], truncated: false },
      issues: [],
      caveats: []
    },
    security: {
      tabId: 'tab-1',
      url: 'https://example.test/',
      origin: 'https://example.test',
      title: 'Example',
      checkedAt: '2026-08-17T00:00:00.000Z',
      state: 'secure',
      secureTransport: true,
      connection: { protocol: 'TLS 1.3' },
      certificate: {
        subjectName: 'example.test',
        issuer: 'Test CA',
        sanList: ['example.test'],
        sanCount: 1,
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: '2027-01-01T00:00:00.000Z',
        valid: true,
        expired: false,
        notYetValid: false,
        daysUntilExpiry: 137
      },
      caveats: []
    },
    pwa: {
      tabId: 'tab-1',
      url: 'https://example.test/',
      origin: 'https://example.test',
      capturedAt: '2026-08-17T00:00:00.000Z',
      supported: true,
      controlled: false,
      registrations: [],
      manifestInspectionAvailable: true,
      installabilityInspectionAvailable: true,
      caches: [],
      cacheInspectionAvailable: true,
      caveats: []
    },
    browserIssues: {
      tabId: 'tab-1',
      url: 'https://example.test/',
      title: 'Example',
      capturedAt: '2026-08-17T00:00:00.000Z',
      issueCount: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      issues: [],
      truncated: false,
      authChallenges: [],
      authChallengesTruncated: false,
      devToolsOpen: false,
      caveats: []
    }
  }
}

function troubledSources(): BrowserQualityAuditSources {
  const value = sources()
  value.accessibility.violationCount = 2
  value.accessibility.affectedNodeCount = 3
  value.accessibility.needsReviewCount = 4
  value.accessibility.violations = [
    { id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', helpUrl: '', description: '', nodeCount: 1, nodes: [] },
    { id: 'image-alt', impact: 'critical', help: 'Images must have alternative text', helpUrl: '', description: '', nodeCount: 2, nodes: [] }
  ]
  value.performance.metrics.LCP = { name: 'LCP', value: 3_200, unit: 'ms', rating: 'needs-improvement', navigationType: 'navigate', targets: [] }
  value.performance.metrics.CLS = { name: 'CLS', value: 0.3, unit: 'score', rating: 'poor', navigationType: 'navigate', targets: [] }
  value.metadata.document.language = null
  value.metadata.structuredData.invalidBlockCount = 2
  value.metadata.issues = [
    { severity: 'warning', code: 'missing-language', message: 'The root html element does not declare a language.' },
    { severity: 'warning', code: 'incomplete-open-graph', message: 'Open Graph metadata is missing og:image.' },
    { severity: 'error', code: 'invalid-json-ld', message: '2 JSON-LD block(s) could not be parsed.' }
  ]
  value.security.state = 'insecure'
  value.security.secureTransport = false
  value.security.connection = undefined
  value.security.certificate = value.security.certificate && { ...value.security.certificate, valid: false, expired: true }
  value.pwa.manifest = { url: 'https://example.test/manifest.json', icons: [], shortcuts: [], parseErrors: [], installabilityErrors: [{ errorId: 'no-icon-available', arguments: [] }] }
  value.pwa.registrations = [{} as BrowserQualityAuditSources['pwa']['registrations'][number]]
  value.pwa.cacheInspectionAvailable = false
  value.browserIssues.issueCount = 2
  value.browserIssues.errorCount = 1
  value.browserIssues.warningCount = 1
  value.browserIssues.issues = [
    { id: 'issue-1', code: 'MixedContentIssue', title: 'Insecure mixed content', severity: 'error', reasons: [], affectedUrls: [], firstSeenAt: '2026-08-17T00:00:00.000Z' },
    { id: 'issue-2', code: 'FutureChromiumIssue', title: 'Future Chromium', severity: 'warning', reasons: [], affectedUrls: [], firstSeenAt: '2026-08-17T00:00:00.000Z' }
  ]
  return value
}

function tab(): BrowserTabState {
  return {
    id: 'tab-1', title: 'Example', url: 'https://example.test/', loading: false, navigationGeneration: 0, canGoBack: false, canGoForward: false,
    active: true, pinned: false, sleeping: false, humanInteractionLocked: false, preserveDiagnosticLogs: false, zoomPercent: 100, audible: false,
    muted: false, devToolsOpen: false
  }
}

async function renderAudit(locale: SupportedLocale, report: BrowserQualityAudit) {
  const browser = {
    measurePerformance: vi.fn(), inspectDesign: vi.fn(), inspectPageMetadata: vi.fn(), inspectSecurity: vi.fn(),
    manageCodeCoverage: vi.fn(), manageCpuProfile: vi.fn(), measureMemory: vi.fn(), createDebugReport: vi.fn(),
    manageRepro: vi.fn(), manageDomChanges: vi.fn(), visualCompare: vi.fn(), copyVisualDiff: vi.fn(),
    listInspectorIssues: vi.fn(), runAccessibilityAudit: vi.fn(), runQualityAudit: vi.fn(async () => report)
  } as DiagnosticsBrowser
  const controller = useDiagnosticsController({
    activeTab: ref<BrowserTabState | undefined>(tab()),
    browser,
    translate: key => key,
    copyText: async () => true,
    closeTransientPanels: vi.fn(),
    keepsSeparatePanelOpen: () => false
  })
  disposers.push(() => controller.dispose())
  render(QualityAuditPanel, { global: { plugins: [createHronautI18n(locale)] }, props: { dock: 'right', controller, locale, keepsSeparatePanelOpen: () => false } })
  controller.toggleQualityAudit()
  const panel = await screen.findByRole('dialog')
  await vi.waitFor(() => expect(panel.querySelector('.quality-audit-categories')).not.toBeNull())
  const texts = (selector: string) => [...panel.querySelectorAll(selector)].map((element) => element.textContent)
  return {
    categories: texts('.quality-audit-categories article header strong'),
    statuses: texts('.quality-audit-categories article header span'),
    summaries: texts('.quality-audit-categories article p'),
    evidence: texts('.quality-audit-categories li'),
    severities: texts('.quality-audit-findings article header span'),
    findingCategories: texts('.quality-audit-findings article header small'),
    findings: texts('.quality-audit-findings article p'),
    caveats: texts('.quality-audit-caveats li')
  }
}

describe('quality audit in the interface language', () => {
  it('names every part of the audit in German, keeping page and Chromium text as reported', async () => {
    const shown = await renderAudit('de-DE', buildBrowserQualityAudit(troubledSources()))

    expect(shown.categories).toEqual(['Barrierefreiheit', 'Leistung', 'Metadaten & SEO', 'Sicherheit', 'PWA & Offline-Betrieb', 'Chromium-Probleme'])
    expect(shown.statuses).toEqual(['Fehler', 'Warnung', 'Fehler', 'Fehler', 'Warnung', 'Fehler'])
    expect(shown.summaries).toEqual([
      '2 Verstöße in 3 betroffenen Knoten',
      'Gut bewertete Web Vitals: 3 von 5',
      '3 Metadatenprobleme',
      'Sicherheitsstatus: nicht sicher',
      '1 Service-Worker-Registrierung · 0 Caches',
      '2 vom Browser erzeugte Probleme'
    ])
    expect(shown.evidence).toEqual([
      '20 Regeln bestanden', '4 Prüfungen erfordern eine manuelle Kontrolle', 'axe-core 4.10.0',
      'LCP: 3.200 ms (verbesserungswürdig)', 'INP: 80 ms (gut)', 'CLS: 0,300 (schlecht)', 'FCP: 900 ms (gut)', 'TTFB: 300 ms (gut)', '4 Ressourcen · 0 lange Aufgaben',
      'Sprache: fehlt', 'Kanonische URLs: 1', 'Strukturierte Daten: 0 gültig · 2 ungültig',
      'Transport: nicht sicher', 'Protokoll: nicht verfügbar', 'Zertifikat: ungültig',
      'Manifest: vorhanden', 'Von einem Service Worker gesteuert: nein', 'Probleme bei der Installierbarkeit: 1',
      '1 Fehler', '1 Warnung', '0 Hinweise'
    ])
    expect(shown.severities).toContain('Fehler')
    expect(shown.findingCategories).toContain('Metadaten & SEO')
    expect(shown.findings).toEqual([
      // axe names its rules in English.
      'Elements must meet minimum color contrast ratio thresholds (1 betroffener Knoten)',
      'Images must have alternative text (2 betroffene Knoten)',
      '4 Barrierefreiheitsprüfungen erfordern eine Kontrolle durch einen Menschen.',
      'LCP ist mit 3.200 ms als „verbesserungswürdig“ bewertet.',
      'CLS ist mit 0,300 als „schlecht“ bewertet.',
      'Das html-Wurzelelement deklariert keine Sprache.',
      'In den Open-Graph-Metadaten fehlt og:image.',
      '2 JSON-LD-Blöcke konnten nicht geparst werden.',
      'Das Hauptdokument verwendet keinen intakten sicheren Transport.',
      'Das Zertifikat des Hauptdokuments ist abgelaufen.',
      'Chromium meldet ein Problem bei der PWA-Installierbarkeit: no-icon-available.',
      'Einige PWA-Diagnosen waren für diese Prüfung nicht verfügbar.',
      'Unsicherer gemischter Inhalt',
      // An issue Hronaut does not know keeps the headline made from its code.
      'Future Chromium'
    ])
    expect(shown.caveats).toHaveLength(5)
    expect(shown.caveats[0]).toBe('Dies ist eine begrenzte lokale Diagnose aus Hronaut-Daten, weder eine Lighthouse-Bewertung noch eine Zertifizierung.')
  })

  it('keeps English as the audit records it', async () => {
    const report = buildBrowserQualityAudit(troubledSources())
    const shown = await renderAudit('en-US', report)

    expect(shown.categories).toEqual(report.categories.map((category) => category.label))
    // States and ratings read as words, as in Connection security and Page performance; a count of one takes the
    // singular; and counts are grouped.
    expect(shown.summaries).toEqual(report.categories.map((category) => category.summary
      .replace('Security state: insecure', 'Security state: not secure')
      .replace('1 service-worker registrations', '1 service-worker registration')))
    expect(shown.evidence).toEqual(report.categories.flatMap((category) => category.evidence)
      .map((item) => item.replace('3200 ms (needs-improvement)', '3,200 ms (needs improvement)').replace(/^1 (error|warning)s$/, '1 $1')))
    // Metadata findings read as in Page metadata.
    expect(shown.findings).toEqual(report.findings.map((finding) => finding.message.replace('3200 ms', '3,200 ms').replace('block(s)', 'blocks')))
    expect(shown.caveats).toEqual(report.caveats)
  })

  it('names a healthy audit in German and keeps it as recorded in English', async () => {
    const report = buildBrowserQualityAudit(sources())
    const german = await renderAudit('de-DE', report)
    expect(german.statuses).toEqual(['bestanden', 'bestanden', 'bestanden', 'bestanden', 'nicht zutreffend', 'bestanden'])
    expect(german.summaries).toEqual([
      'Keine automatisch erkannten WCAG-AA-Verstöße',
      'Gut bewertete Web Vitals: 5 von 5',
      'Keine Metadatenprobleme gefunden',
      'Sicherer Transport des Hauptdokuments',
      'Keine PWA- oder Offline-App-Funktionen erkannt',
      'Keine gespeicherten Chromium-Probleme gefunden'
    ])
    expect(german.evidence).toEqual(expect.arrayContaining(['Sprache: en', 'Transport: sicher', 'Protokoll: TLS 1.3', 'Zertifikat: gültig', 'Manifest: nicht erkannt']))
    cleanup()

    const english = await renderAudit('en-US', report)
    expect(english.statuses).toEqual(report.categories.map((category) => category.status.replace('-', ' ')))
    expect(english.summaries).toEqual(report.categories.map((category) => category.summary))
    expect(english.evidence).toEqual(report.categories.flatMap((category) => category.evidence).map((item) => item.replace('1200 ms', '1,200 ms')))
  })

  it('shows text the audit helpers did not write as recorded', async () => {
    const report = buildBrowserQualityAudit(sources())
    const changed: BrowserQualityAudit = {
      ...report,
      categories: [
        { ...report.categories[0], summary: '2 violations across 3 affected nodes (bounded)', evidence: ['007 rules passed', 'Language: '] },
        { ...report.categories[1], id: 'toString' as never, label: 'Future category', status: 'future' as never, summary: 'Future summary', evidence: [] }
      ],
      findings: [
        { category: 'browser-issues', severity: 'warning', code: 'toString', message: 'Inherited' },
        { category: 'metadata', severity: 'warning', code: 'constructor', message: 'Page-specific metadata note' },
        { category: 'accessibility', severity: 'error', code: 'label', message: 'Form elements must have labels (1 affected nodes)' }
      ],
      caveats: ['A future caveat.']
    }
    const shown = await renderAudit('de-DE', changed)

    expect(shown.categories).toEqual(['Barrierefreiheit', 'Future category'])
    expect(shown.statuses).toEqual(['bestanden', 'future'])
    expect(shown.summaries[0]).toBe('2 violations across 3 affected nodes (bounded)')
    expect(shown.evidence).toEqual(['007 rules passed', 'Language: '])
    expect(shown.findingCategories).toEqual(['Chromium-Probleme', 'Metadaten & SEO', 'Barrierefreiheit'])
    expect(shown.findings).toEqual(['Inherited', 'Page-specific metadata note', 'Form elements must have labels (1 affected nodes)'])
    expect(shown.caveats).toEqual(['A future caveat.'])
  })
})
