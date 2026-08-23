import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  PERFORMANCE_AUDIT_LIMITS,
  buildPerformanceComparison,
  normalizePerformanceOptions,
  performanceAuditPageScript,
  sanitizePerformanceReport
} from '../src/shared/performance-audit.js'
import type { BrowserPerformanceReport } from '../src/shared/types.js'

function sampleReport(values: {
  url?: string
  measuredAt?: string
  lcp?: number | null
  cls?: number | null
  load?: number | null
  transfer?: number | null
  longTaskBlocking?: number | null
  loafBlocking?: number | null
} = {}): BrowserPerformanceReport {
  const metric = (name: 'LCP' | 'CLS', value: number | null, unit: 'ms' | 'score') => value === null
    ? null
    : { name, value, unit, rating: 'good' as const, navigationType: 'navigate', targets: [] }
  return {
    tabId: 'tab-1',
    url: values.url ?? 'https://example.test/page',
    title: 'Example',
    measuredAt: values.measuredAt ?? '2026-08-16T10:00:00.000Z',
    observedAt: '2026-08-16T10:00:00.000Z',
    scope: 'current-visit',
    engine: { name: 'web-vitals', version: '6.1.0' },
    metrics: {
      LCP: metric('LCP', values.lcp === undefined ? 2_000 : values.lcp, 'ms'),
      CLS: metric('CLS', values.cls === undefined ? 0.05 : values.cls, 'score'),
      INP: null,
      FCP: null,
      TTFB: null
    },
    navigation: {
      type: 'navigate',
      responseStartMs: 100,
      domContentLoadedMs: 500,
      loadMs: values.load === undefined ? 1_000 : values.load,
      transferBytes: 0,
      encodedBodyBytes: 0,
      decodedBodyBytes: 0
    },
    resources: {
      count: 1,
      transferBytes: values.transfer === undefined ? 10_000 : values.transfer,
      encodedBodyBytes: 0,
      decodedBodyBytes: 0,
      byType: []
    },
    longTasks: {
      supported: true,
      count: 1,
      totalDurationMs: 80,
      blockingTimeMs: values.longTaskBlocking === undefined ? 30 : values.longTaskBlocking,
      longestDurationMs: 80
    },
    longAnimationFrames: {
      supported: true,
      count: 1,
      totalDurationMs: 90,
      blockingDurationMs: values.loafBlocking === undefined ? 40 : values.loafBlocking,
      longestDurationMs: 90,
      renderDurationMs: 20,
      styleAndLayoutDurationMs: 10,
      frames: [],
      contributors: [],
      truncated: false
    },
    userTimings: { count: 0, entries: [], truncated: false },
    layoutShifts: { supported: true, count: 0, scoreSum: 0, recentInputCount: 0, entries: [], truncated: false },
    caveats: []
  }
}

describe('performance audit', () => {
  it('defaults to a short bounded local collection window', () => {
    expect(normalizePerformanceOptions()).toEqual({ settleMs: 800, action: 'measure' })
    expect(normalizePerformanceOptions({ settleMs: 0 })).toEqual({ settleMs: 0, action: 'measure' })
    expect(normalizePerformanceOptions({ settleMs: PERFORMANCE_AUDIT_LIMITS.maxSettleMs })).toEqual({
      settleMs: PERFORMANCE_AUDIT_LIMITS.maxSettleMs,
      action: 'measure'
    })
    expect(normalizePerformanceOptions({ action: 'set-baseline' })).toEqual({ settleMs: 800, action: 'set-baseline' })
  })

  it('rejects invalid collection windows', () => {
    expect(() => normalizePerformanceOptions({ settleMs: -1 })).toThrow('settleMs')
    expect(() => normalizePerformanceOptions({ settleMs: 1.5 })).toThrow('settleMs')
    expect(() => normalizePerformanceOptions({ settleMs: PERFORMANCE_AUDIT_LIMITS.maxSettleMs + 1 })).toThrow('settleMs')
    expect(() => normalizePerformanceOptions({ action: 'invalid' as 'measure' })).toThrow('action')
  })

  it('compares a current sample with a baseline and keeps missing metrics explicit', () => {
    const baseline = sampleReport()
    const current = sampleReport({ lcp: 1_750, cls: 0.051, load: 1_150, transfer: 10_500, longTaskBlocking: null })
    const environment = {
      network: 'slow-4g' as const,
      cacheDisabled: true,
      bypassServiceWorker: false,
      dataSaver: 'auto' as const,
      cpuThrottlingRate: 4,
      animationPlaybackRate: 1 as const,
      viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true },
      zoomPercent: 100,
      userAgentOverridden: true,
      localeOverridden: false,
      timezoneOverridden: false,
      extraHttpHeaders: false
    }
    const result = buildPerformanceComparison(baseline, current, environment, environment)
    expect(result.baseline).toMatchObject({ measuredAt: baseline.measuredAt, url: baseline.url, environment })
    expect(result.comparison).toMatchObject({ sameUrl: true, sameEnvironment: true })
    expect(result.comparison.metrics.find((metric) => metric.name === 'LCP')).toMatchObject({
      baselineValue: 2_000,
      currentValue: 1_750,
      delta: -250,
      direction: 'improved'
    })
    expect(result.comparison.metrics.find((metric) => metric.name === 'CLS')).toMatchObject({
      delta: 0.001,
      direction: 'unchanged'
    })
    expect(result.comparison.metrics.find((metric) => metric.name === 'LOAD')).toMatchObject({
      delta: 150,
      direction: 'regressed'
    })
    expect(result.comparison.metrics.find((metric) => metric.name === 'TRANSFER')).toMatchObject({
      delta: 500,
      direction: 'unchanged'
    })
    expect(result.comparison.metrics.find((metric) => metric.name === 'LONG_TASK_BLOCKING')).toMatchObject({
      currentValue: null,
      delta: null,
      direction: 'unavailable'
    })
  })

  it('flags URL and environment mismatches independently', () => {
    const baseline = sampleReport()
    const current = sampleReport({ url: 'https://example.test/after' })
    const environment = {
      network: 'none' as const,
      cacheDisabled: false,
      bypassServiceWorker: false,
      dataSaver: 'auto' as const,
      cpuThrottlingRate: 1,
      animationPlaybackRate: 1 as const,
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, touch: false },
      zoomPercent: 100,
      userAgentOverridden: false,
      localeOverridden: false,
      timezoneOverridden: false,
      extraHttpHeaders: false
    }
    expect(buildPerformanceComparison(baseline, current, environment, environment, false).comparison).toMatchObject({
      sameUrl: false,
      sameEnvironment: false
    })
  })

  it('builds a bounded collector without returning page markup or resource URLs', () => {
    const script = performanceAuditPageScript(
      'globalThis.webVitals = { onLCP() {}, onINP() {}, onCLS() {}, onFCP() {}, onTTFB() {} };',
      normalizePerformanceOptions(),
      '6.1.0'
    )
    expect(script).toContain('__hronautPerformanceCollector')
    expect(script).toContain("scope: 'current-visit'")
    expect(script).toContain("getEntriesByType('resource')")
    expect(script).toContain("includes('long-animation-frame')")
    expect(script).toContain("includes('layout-shift')")
    expect(script).toContain('entry.hadRecentInput')
    expect(script).toContain("getEntriesByType('mark')")
    expect(script).toContain("getEntriesByType('measure')")
    expect(script).toContain('slice(-config.maxUserTimings)')
    expect(script).toContain('forcedStyleAndLayoutDurationMs')
    expect(script).not.toContain('outerHTML')
    expect(script).not.toContain('entry.detail')
  })

  it('retains the highest-scoring layout shifts when the collector reaches its bound', async () => {
    const entries = [
      { startTime: 1, value: 0.99, hadRecentInput: false, sources: [] },
      ...Array.from({ length: PERFORMANCE_AUDIT_LIMITS.maxLayoutShifts }, (_, index) => ({
        startTime: index + 2,
        value: 0.01,
        hadRecentInput: false,
        sources: []
      }))
    ]
    class MockPerformanceObserver {
      static supportedEntryTypes = ['layout-shift']

      constructor(private readonly callback: (list: { getEntries(): typeof entries }) => void) {}

      observe(options: { type: string }): void {
        if (options.type === 'layout-shift') this.callback({ getEntries: () => entries })
      }
    }
    const report = await runInNewContext(
      performanceAuditPageScript(
        'globalThis.webVitals = { onLCP() {}, onINP() {}, onCLS() {}, onFCP() {}, onTTFB() {} };',
        normalizePerformanceOptions({ settleMs: 0 }),
        '6.1.0'
      ),
      {
        PerformanceObserver: MockPerformanceObserver,
        performance: { getEntriesByType: () => [] },
        location: { href: 'https://example.test/layout-shifts' },
        document: { title: 'Layout shift burst' },
        setTimeout
      }
    ) as BrowserPerformanceReport

    expect(report.layoutShifts).toMatchObject({
      count: PERFORMANCE_AUDIT_LIMITS.maxLayoutShifts + 1,
      truncated: true
    })
    expect(report.layoutShifts.entries).toHaveLength(PERFORMANCE_AUDIT_LIMITS.maxReportedLayoutShifts)
    expect(report.layoutShifts.entries[0]).toMatchObject({ startTimeMs: 1, value: 0.99 })
  })

  it('redacts page-authored performance attribution before returning it', () => {
    const report = sanitizePerformanceReport({
      tabId: 'tab-1',
      url: 'https://example.test/page?token=page-secret&view=kept#fragment',
      title: 'Dashboard token=title-secret',
      measuredAt: '2026-08-15T00:00:00.000Z',
      observedAt: '2026-08-15T00:00:00.000Z',
      scope: 'current-visit',
      engine: { name: 'web-vitals', version: '6.1.0' },
      metrics: {
        LCP: {
          name: 'LCP',
          value: 10,
          unit: 'ms',
          rating: 'good',
          navigationType: 'navigate token=navigation-secret',
          targets: ['#target-token=selector-secret']
        },
        INP: null,
        CLS: null,
        FCP: null,
        TTFB: null
      },
      navigation: null,
      resources: { count: 0, transferBytes: 0, encodedBodyBytes: 0, decodedBodyBytes: 0, byType: [] },
      longTasks: {
        supported: true,
        count: 1,
        totalDurationMs: 80,
        blockingTimeMs: 30,
        longestDurationMs: 80
      },
      longAnimationFrames: {
        supported: true,
        count: 1,
        totalDurationMs: 90,
        blockingDurationMs: 40,
        longestDurationMs: 90,
        renderDurationMs: 20,
        styleAndLayoutDurationMs: 10,
        frames: [{
          startTimeMs: 100,
          durationMs: 90,
          blockingDurationMs: 40,
          renderDurationMs: 20,
          styleAndLayoutDurationMs: 10,
          firstUIEventDelayMs: null,
          scriptCount: 1
        }],
        contributors: [{
          sourceUrl: 'https://example.test/app.js?token=script-secret&variant=kept#source',
          sourceFunctionName: 'run token=function-secret',
          invoker: 'button.onclick token=invoker-secret',
          invokerType: 'event-listener',
          count: 1,
          totalDurationMs: 70,
          forcedStyleAndLayoutDurationMs: 8
        }],
        truncated: false
      },
      userTimings: {
        count: 2,
        entries: [
          { type: 'mark', name: 'login-start token=user-timing-secret', startTimeMs: 10, durationMs: 0 },
          { type: 'measure', name: 'login-duration kept', startTimeMs: 10, durationMs: 25 }
        ],
        truncated: false
      },
      layoutShifts: {
        supported: true,
        count: 1,
        scoreSum: 0.04,
        recentInputCount: 1,
        entries: [{
          startTimeMs: 120,
          value: 0.04,
          sources: ['#layout-target-token=layout-source-secret', 'main > article:nth-of-type(2)']
        }],
        truncated: false
      },
      caveats: []
    } satisfies BrowserPerformanceReport)

    expect(JSON.stringify(report)).not.toContain('page-secret')
    expect(JSON.stringify(report)).not.toContain('title-secret')
    expect(JSON.stringify(report)).not.toContain('script-secret')
    expect(JSON.stringify(report)).not.toContain('function-secret')
    expect(JSON.stringify(report)).not.toContain('invoker-secret')
    expect(JSON.stringify(report)).not.toContain('user-timing-secret')
    expect(JSON.stringify(report)).not.toContain('layout-source-secret')
    expect(report.url).toContain('view=kept')
    expect(report.longAnimationFrames.contributors[0]?.sourceUrl).toContain('variant=kept')
    expect(report.userTimings.entries[1]?.name).toContain('kept')
    expect(report.layoutShifts.entries[0]?.sources[1]).toContain('article')
  })
})
