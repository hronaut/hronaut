import { describe, expect, it } from 'vitest'
import { buildBrowserQualityAudit, type BrowserQualityAuditSources } from '../src/shared/quality-audit.js'

function sources(): BrowserQualityAuditSources {
  return {
    accessibility: {
      tabId: 'tab-1',
      url: 'https://example.test/',
      title: 'Example',
      auditedAt: '2026-08-17T00:00:00.000Z',
      standard: 'wcag-aa',
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
      devToolsOpen: false,
      caveats: []
    }
  }
}

describe('quality audit', () => {
  it('passes healthy observed evidence without treating an ordinary website as a failed PWA', () => {
    const report = buildBrowserQualityAudit(sources())
    expect(report.status).toBe('pass')
    expect(report.totals).toEqual({ errors: 0, warnings: 0, info: 0 })
    expect(report.categories.find((category) => category.id === 'pwa')).toMatchObject({
      status: 'not-applicable',
      findingCount: 0
    })
  })

  it('classifies serious accessibility, slow Web Vitals, metadata, security, PWA, and browser evidence', () => {
    const input = sources()
    input.accessibility.violations.push({
      id: 'button-name',
      impact: 'serious',
      help: 'Buttons must have discernible text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/button-name',
      description: 'Ensure buttons have discernible text',
      nodeCount: 2,
      nodes: []
    })
    input.accessibility.violationCount = 1
    input.accessibility.affectedNodeCount = 2
    input.performance.metrics.LCP = { name: 'LCP', value: 4_500, unit: 'ms', rating: 'poor', navigationType: 'navigate', targets: [] }
    input.metadata.issues.push({ severity: 'warning', code: 'description-missing', message: 'Add a meta description.' })
    input.security.state = 'insecure'
    input.security.secureTransport = false
    input.pwa.manifest = {
      url: 'https://example.test/app.webmanifest',
      icons: [],
      shortcuts: [],
      parseErrors: [{ message: 'Manifest is invalid', critical: true }],
      installabilityErrors: []
    }
    input.browserIssues.issues.push({
      id: 'issue-1',
      code: 'MixedContentIssue',
      title: 'Mixed content was blocked',
      severity: 'error',
      reasons: [],
      affectedUrls: [],
      firstSeenAt: '2026-08-17T00:00:00.000Z'
    })
    input.browserIssues.issueCount = 1
    input.browserIssues.errorCount = 1

    const report = buildBrowserQualityAudit(input)
    expect(report.status).toBe('error')
    expect(report.totals.errors).toBe(4)
    expect(report.totals.warnings).toBe(2)
    expect(report.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'accessibility', status: 'error' }),
      expect.objectContaining({ id: 'performance', status: 'warning' }),
      expect.objectContaining({ id: 'security', status: 'error' }),
      expect.objectContaining({ id: 'pwa', status: 'error' })
    ]))
  })

  it('bounds returned findings while retaining complete totals', () => {
    const input = sources()
    input.browserIssues.issues = Array.from({ length: 45 }, (_, index) => ({
      id: `issue-${index}`,
      code: 'GenericIssue',
      title: `Issue ${index}`,
      severity: 'warning' as const,
      reasons: [],
      affectedUrls: [],
      firstSeenAt: '2026-08-17T00:00:00.000Z'
    }))
    input.browserIssues.issueCount = 45
    input.browserIssues.warningCount = 45

    const report = buildBrowserQualityAudit(input)
    expect(report.findings).toHaveLength(40)
    expect(report.totals.warnings).toBe(45)
    expect(report.truncated).toBe(true)
  })
})
