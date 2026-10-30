import type { LcpAttributionMetric } from './performance-lcp.page.js'
import type {
  BrowserPerformanceLcpAttribution,
  BrowserPerformanceLayoutShift,
  BrowserPerformanceMetric,
  BrowserPerformanceMetricName,
  BrowserPerformanceReport,
  BrowserPerformanceScriptContributor,
  BrowserPerformanceSoftNavigations,
  BrowserPerformanceUserTiming
} from './types.js'

/** The measurement's options and bounds, as main sends them to the page. */
export interface PerformanceAuditPageConfig {
  settleMs: number
  action: string
  version: string
  documentRouted: boolean
  maxTargets: number
  maxTargetChars: number
  maxLongAnimationFrames: number
  maxReportedLongAnimationFrames: number
  maxScriptContributors: number
  maxAttributionChars: number
  maxSourceUrlChars: number
  maxUserTimings: number
  maxUserTimingNameChars: number
  maxLayoutShifts: number
  maxReportedLayoutShifts: number
  maxLayoutShiftSources: number
}

/** The parts of a web-vitals metric the collector reads. */
interface WebVitalsMetric extends LcpAttributionMetric {
  name: string
  rating: string
  entries?: Array<{ element?: unknown; target?: unknown; sources?: Array<{ node?: unknown }> }>
}

type WebVitalsObserve = (callback: (metric: WebVitalsMetric) => void, options: Record<string, unknown>) => void

/** A long animation frame entry, which the DOM library does not describe yet. */
interface LongAnimationFrameEntry {
  startTime: number
  duration: number
  renderStart: number
  styleAndLayoutStart: number
  firstUIEventTimestamp: number
  blockingDuration: number
  scripts?: Iterable<{
    sourceURL: string
    sourceFunctionName: string
    sourceCharPosition: number
    invoker: string
    invokerType: string
    duration: number
    forcedStyleAndLayoutDuration: number
  }>
}

/** A layout shift entry, which the DOM library does not describe yet. */
interface LayoutShiftEntry {
  startTime: number
  value: number
  hadRecentInput: boolean
  sources?: Iterable<{ node?: unknown }>
}

/** A long animation frame as the collector keeps it, with each script's bounded attribution. */
interface CollectedLongAnimationFrame {
  startTimeMs: number
  durationMs: number
  blockingDurationMs: number
  renderDurationMs: number
  styleAndLayoutDurationMs: number
  firstUIEventDelayMs: number | null
  scripts: Array<{
    sourceUrl: string
    sourceFunctionName: string
    sourceCharPosition: number | undefined
    invoker: string
    invokerType: string
    durationMs: number
    forcedStyleAndLayoutDurationMs: number
  }>
}

/** What the page keeps observing between measurements, from the first one on. */
interface PerformanceCollector {
  metrics: Record<BrowserPerformanceMetricName, BrowserPerformanceMetric | null>
  softNavigations: () => BrowserPerformanceSoftNavigations
  longTasks: Array<{ startTime: number; duration: number }>
  longTaskSupported: boolean
  longAnimationFrames: CollectedLongAnimationFrame[]
  longAnimationFrameSupported: boolean
  readonly longAnimationFramesTruncated: boolean
  layoutShifts: BrowserPerformanceLayoutShift[]
  layoutShiftSupported: boolean
  readonly layoutShiftCount: number
  readonly layoutShiftScoreSum: number
  readonly layoutShiftRecentInputCount: number
  readonly layoutShiftsTruncated: boolean
  observedAt: string
}

type PerformancePage = typeof globalThis & {
  __hronautPerformanceCollector?: PerformanceCollector
  webVitals: Record<'onLCP' | 'onINP' | 'onCLS' | 'onFCP' | 'onTTFB', WebVitalsObserve>
}

/**
 * Runs in the isolated performance world, after web-vitals has loaded: on the first measurement it starts collecting
 * metrics, long tasks, long animation frames and layout shifts, and each measurement then waits settleMs and reports
 * them, with the navigation, resources and user timings, as bounded plain values. The LCP attribution and soft
 * navigation functions come in as arguments.
 */
export function performanceAuditInPage(
  config: PerformanceAuditPageConfig,
  lcpAttribution: (metric: LcpAttributionMetric) => BrowserPerformanceLcpAttribution,
  collectSoftNavigations: () => () => BrowserPerformanceSoftNavigations,
  caveats: string[]
): Promise<Omit<BrowserPerformanceReport, 'tabId'>> {
  const page = globalThis as PerformancePage
  const boundedText = (value: unknown, max: number): string => String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, max)
  const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : null
  // Unitless layout-shift scores need the browser's precision: rounding each
  // small shift like a millisecond duration can erase their cumulative impact.
  const finiteScore = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null
  const selectorFor = (value: unknown): string => {
    if (!(value instanceof Element)) return ''
    try {
      if (value.id) return boundedText('#' + CSS.escape(value.id), config.maxTargetChars)
      const parts: string[] = []
      let node: Element | null = value
      while (node && node !== document.documentElement && parts.length < 4) {
        let part = node.localName || 'element'
        const parent: Element | null = node.parentElement
        if (parent) {
          const current: Element = node
          const siblings = Array.from(parent.children).filter((sibling) => sibling.localName === current.localName)
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')'
        }
        parts.unshift(part)
        node = parent
      }
      return boundedText(parts.join(' > '), config.maxTargetChars)
    } catch {
      return boundedText(value.localName || '', config.maxTargetChars)
    }
  }
  const metricTargets = (metric: WebVitalsMetric): string[] => {
    const targets: string[] = []
    for (const entry of metric.entries || []) {
      const candidates = [entry.element, entry.target, ...(entry.sources || []).map((source) => source.node)]
      for (const candidate of candidates) {
        const selector = selectorFor(candidate)
        if (selector && !targets.includes(selector)) targets.push(selector)
        if (targets.length >= config.maxTargets) return targets
      }
    }
    return targets
  }
  const sourceUrl = (value: unknown): string => {
    try {
      const url = new URL(String(value || ''), location.href)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
      url.username = ''
      url.password = ''
      url.search = ''
      url.hash = ''
      return boundedText(url.href, config.maxSourceUrlChars)
    } catch { return '' }
  }
  const longAnimationFrame = (entry: LongAnimationFrameEntry): CollectedLongAnimationFrame => {
    const endTime = (finite(entry.startTime) || 0) + (finite(entry.duration) || 0)
    const renderStart = finite(entry.renderStart) || 0
    const styleAndLayoutStart = finite(entry.styleAndLayoutStart) || 0
    const firstUIEventTimestamp = finite(entry.firstUIEventTimestamp) || 0
    return {
      startTimeMs: finite(entry.startTime) || 0,
      durationMs: finite(entry.duration) || 0,
      blockingDurationMs: finite(entry.blockingDuration) || 0,
      renderDurationMs: renderStart > 0 ? finite(endTime - renderStart) || 0 : 0,
      styleAndLayoutDurationMs: styleAndLayoutStart > 0 ? finite(endTime - styleAndLayoutStart) || 0 : 0,
      firstUIEventDelayMs: firstUIEventTimestamp > 0 ? finite((finite(entry.startTime) || 0) - firstUIEventTimestamp) : null,
      scripts: Array.from(entry.scripts || []).map((script) => ({
        sourceUrl: sourceUrl(script.sourceURL),
        sourceFunctionName: boundedText(script.sourceFunctionName, config.maxAttributionChars),
        sourceCharPosition: Number.isFinite(script.sourceCharPosition) && script.sourceCharPosition >= 0
          ? Math.floor(script.sourceCharPosition)
          : undefined,
        invoker: boundedText(script.invoker, config.maxAttributionChars),
        invokerType: boundedText(script.invokerType, 80),
        durationMs: finite(script.duration) || 0,
        forcedStyleAndLayoutDurationMs: finite(script.forcedStyleAndLayoutDuration) || 0
      }))
    }
  }
  if (!page.__hronautPerformanceCollector) {
    const softNavigations = collectSoftNavigations()
    const metrics: PerformanceCollector['metrics'] = { LCP: null, INP: null, CLS: null, FCP: null, TTFB: null }
    const updateMetric = (metric: WebVitalsMetric): void => {
      const name = (metric && metric.name) as BrowserPerformanceMetricName
      if (!(name in metrics)) return
      metrics[name] = {
        name,
        value: name === 'CLS' ? finiteScore(metric.value) : finite(metric.value),
        unit: name === 'CLS' ? 'score' : 'ms',
        rating: ['good', 'needs-improvement', 'poor'].includes(metric.rating) ? metric.rating : 'needs-improvement',
        navigationType: boundedText(metric.navigationType || 'navigate', 80),
        targets: metricTargets(metric),
        ...(name === 'LCP' ? { lcpAttribution: lcpAttribution(metric) } : {})
      } as BrowserPerformanceMetric
    }
    const observe = (callback: WebVitalsObserve, options: Record<string, unknown> = {}): void => {
      try { callback(updateMetric, { reportAllChanges: true, ...options }) } catch { /* Unsupported metric. */ }
    }
    observe(page.webVitals.onLCP, { generateTarget: selectorFor })
    observe(page.webVitals.onINP)
    observe(page.webVitals.onCLS)
    observe(page.webVitals.onFCP)
    observe(page.webVitals.onTTFB)
    const longTasks: PerformanceCollector['longTasks'] = []
    let longTaskSupported = false
    try {
      if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
        longTaskSupported = true
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push({ startTime: entry.startTime, duration: entry.duration })
            if (longTasks.length > 500) longTasks.splice(0, longTasks.length - 500)
          }
        })
        observer.observe({ type: 'longtask', buffered: true })
      }
    } catch { longTaskSupported = false }
    const longAnimationFrames: CollectedLongAnimationFrame[] = []
    let longAnimationFrameSupported = false
    let longAnimationFramesTruncated = false
    try {
      if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes('long-animation-frame')) {
        longAnimationFrameSupported = true
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longAnimationFrames.push(longAnimationFrame(entry as unknown as LongAnimationFrameEntry))
            if (longAnimationFrames.length > config.maxLongAnimationFrames) {
              longAnimationFrames.splice(0, longAnimationFrames.length - config.maxLongAnimationFrames)
              longAnimationFramesTruncated = true
            }
          }
        })
        observer.observe({ type: 'long-animation-frame', buffered: true })
      }
    } catch { longAnimationFrameSupported = false }
    const layoutShifts: BrowserPerformanceLayoutShift[] = []
    let layoutShiftSupported = false
    let layoutShiftCount = 0
    let layoutShiftScoreSum = 0
    let layoutShiftRecentInputCount = 0
    let layoutShiftsTruncated = false
    try {
      if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes('layout-shift')) {
        layoutShiftSupported = true
        const observer = new PerformanceObserver((list) => {
          for (const shift of list.getEntries()) {
            const entry = shift as unknown as LayoutShiftEntry
            if (entry.hadRecentInput) {
              layoutShiftRecentInputCount += 1
              continue
            }
            const value = finiteScore(entry.value) || 0
            layoutShiftCount += 1
            layoutShiftScoreSum += value
            layoutShifts.push({
              startTimeMs: finite(entry.startTime) || 0,
              value,
              sources: Array.from(entry.sources || [])
                .map((source) => selectorFor(source.node))
                .filter(Boolean)
                .slice(0, config.maxLayoutShiftSources)
            })
            if (layoutShifts.length > config.maxLayoutShifts) {
              layoutShifts.sort((left, right) => right.value - left.value || left.startTimeMs - right.startTimeMs)
              layoutShifts.splice(config.maxLayoutShifts)
              layoutShiftsTruncated = true
            }
          }
        })
        observer.observe({ type: 'layout-shift', buffered: true })
      }
    } catch { layoutShiftSupported = false }
    page.__hronautPerformanceCollector = {
      metrics,
      softNavigations,
      longTasks,
      longTaskSupported,
      longAnimationFrames,
      longAnimationFrameSupported,
      get longAnimationFramesTruncated() { return longAnimationFramesTruncated },
      layoutShifts,
      layoutShiftSupported,
      get layoutShiftCount() { return layoutShiftCount },
      get layoutShiftScoreSum() { return layoutShiftScoreSum },
      get layoutShiftRecentInputCount() { return layoutShiftRecentInputCount },
      get layoutShiftsTruncated() { return layoutShiftsTruncated },
      observedAt: new Date().toISOString()
    }
  }
  return new Promise((resolve) => setTimeout(() => {
    const collector = page.__hronautPerformanceCollector!
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const byType = new Map<string, { type: string; count: number; transferBytes: number }>()
    let transferBytes = 0
    let encodedBodyBytes = 0
    let decodedBodyBytes = 0
    for (const entry of resources) {
      const type = boundedText(entry.initiatorType || 'other', 40) || 'other'
      const group = byType.get(type) || { type, count: 0, transferBytes: 0 }
      group.count += 1
      group.transferBytes += finite(entry.transferSize) || 0
      byType.set(type, group)
      transferBytes += finite(entry.transferSize) || 0
      encodedBodyBytes += finite(entry.encodedBodySize) || 0
      decodedBodyBytes += finite(entry.decodedBodySize) || 0
    }
    const longTaskDurations = collector.longTasks.map((entry) => finite(entry.duration) || 0)
    const longFrames = collector.longAnimationFrames || []
    const layoutShifts = collector.layoutShifts || []
    const userMarks = performance.getEntriesByType('mark')
    const userMeasures = performance.getEntriesByType('measure')
    const allUserTimingCount = userMarks.length + userMeasures.length
    const allUserTimings: BrowserPerformanceUserTiming[] = [
      ...userMarks.slice(-config.maxUserTimings).map((entry) => ({
        type: 'mark' as const,
        name: boundedText(entry.name, config.maxUserTimingNameChars) || '(unnamed)',
        startTimeMs: finite(entry.startTime) || 0,
        durationMs: 0
      })),
      ...userMeasures.slice(-config.maxUserTimings).map((entry) => ({
        type: 'measure' as const,
        name: boundedText(entry.name, config.maxUserTimingNameChars) || '(unnamed)',
        startTimeMs: finite(entry.startTime) || 0,
        durationMs: finite(entry.duration) || 0
      }))
    ].sort((left, right) => left.startTimeMs - right.startTimeMs)
    const contributorMap = new Map<string, BrowserPerformanceScriptContributor>()
    for (const frame of longFrames) {
      for (const script of frame.scripts || []) {
        const key = JSON.stringify([
          script.sourceUrl || '',
          script.sourceFunctionName || '',
          script.sourceCharPosition ?? null,
          script.invoker || '',
          script.invokerType || ''
        ])
        const contributor = contributorMap.get(key) || {
          ...(script.sourceUrl ? { sourceUrl: script.sourceUrl } : {}),
          ...(script.sourceFunctionName ? { sourceFunctionName: script.sourceFunctionName } : {}),
          ...(script.sourceCharPosition !== undefined ? { sourceCharPosition: script.sourceCharPosition } : {}),
          ...(script.invoker ? { invoker: script.invoker } : {}),
          ...(script.invokerType ? { invokerType: script.invokerType } : {}),
          count: 0,
          totalDurationMs: 0,
          forcedStyleAndLayoutDurationMs: 0
        }
        contributor.count += 1
        contributor.totalDurationMs += script.durationMs
        contributor.forcedStyleAndLayoutDurationMs += script.forcedStyleAndLayoutDurationMs
        contributorMap.set(key, contributor)
      }
    }
    const longFrameDurations = longFrames.map((entry) => entry.durationMs)
    const metrics = { ...collector.metrics }
    // The default Web Vitals observer is document-scoped, not SPA-scoped.
    // The main process remembers routing even if the URL returns between reads.
    // Do not label an earlier candidate as fresh phase evidence after routing.
    if (metrics.LCP && (config.documentRouted || (navigation?.name && navigation.name !== location.href))) {
      metrics.LCP = { ...metrics.LCP, lcpAttribution: lcpAttribution({ navigationType: 'soft-navigation' } as LcpAttributionMetric) }
    }
    resolve({
      url: boundedText(location.href, 4096),
      title: boundedText(document.title, 500),
      measuredAt: new Date().toISOString(),
      observedAt: collector.observedAt,
      scope: 'current-visit',
      softNavigations: collector.softNavigations(),
      engine: { name: 'web-vitals', version: config.version },
      metrics,
      navigation: navigation ? {
        type: boundedText(navigation.type || 'navigate', 40),
        responseStartMs: finite(navigation.responseStart),
        domContentLoadedMs: finite(navigation.domContentLoadedEventEnd),
        loadMs: finite(navigation.loadEventEnd),
        transferBytes: finite(navigation.transferSize),
        encodedBodyBytes: finite(navigation.encodedBodySize),
        decodedBodyBytes: finite(navigation.decodedBodySize)
      } : null,
      resources: {
        count: resources.length,
        transferBytes: finite(transferBytes),
        encodedBodyBytes: finite(encodedBodyBytes),
        decodedBodyBytes: finite(decodedBodyBytes),
        byType: Array.from(byType.values())
          .sort((left, right) => right.transferBytes - left.transferBytes || right.count - left.count)
          .slice(0, 20)
          .map((group) => ({ ...group, transferBytes: finite(group.transferBytes) }))
      },
      longTasks: {
        supported: collector.longTaskSupported,
        count: longTaskDurations.length,
        totalDurationMs: finite(longTaskDurations.reduce((total, duration) => total + duration, 0)),
        blockingTimeMs: finite(longTaskDurations.reduce((total, duration) => total + Math.max(0, duration - 50), 0)),
        longestDurationMs: finite(longTaskDurations.length ? Math.max(...longTaskDurations) : 0)
      },
      longAnimationFrames: {
        supported: collector.longAnimationFrameSupported,
        count: longFrames.length,
        totalDurationMs: finite(longFrameDurations.reduce((total, duration) => total + duration, 0)),
        blockingDurationMs: finite(longFrames.reduce((total, entry) => total + entry.blockingDurationMs, 0)),
        longestDurationMs: finite(longFrameDurations.length ? Math.max(...longFrameDurations) : 0),
        renderDurationMs: finite(longFrames.reduce((total, entry) => total + entry.renderDurationMs, 0)),
        styleAndLayoutDurationMs: finite(longFrames.reduce((total, entry) => total + entry.styleAndLayoutDurationMs, 0)),
        frames: [...longFrames]
          .sort((left, right) => right.blockingDurationMs - left.blockingDurationMs || right.durationMs - left.durationMs)
          .slice(0, config.maxReportedLongAnimationFrames)
          .map((entry) => ({
            startTimeMs: entry.startTimeMs,
            durationMs: entry.durationMs,
            blockingDurationMs: entry.blockingDurationMs,
            renderDurationMs: entry.renderDurationMs,
            styleAndLayoutDurationMs: entry.styleAndLayoutDurationMs,
            firstUIEventDelayMs: entry.firstUIEventDelayMs,
            scriptCount: entry.scripts.length
          })),
        contributors: Array.from(contributorMap.values())
          .sort((left, right) => right.totalDurationMs - left.totalDurationMs || right.count - left.count)
          .slice(0, config.maxScriptContributors)
          .map((entry) => ({
            ...entry,
            totalDurationMs: finite(entry.totalDurationMs) || 0,
            forcedStyleAndLayoutDurationMs: finite(entry.forcedStyleAndLayoutDurationMs) || 0
          })),
        truncated: collector.longAnimationFramesTruncated || longFrames.length > config.maxReportedLongAnimationFrames
      },
      userTimings: {
        count: allUserTimingCount,
        entries: allUserTimings.slice(-config.maxUserTimings),
        truncated: allUserTimingCount > config.maxUserTimings
      },
      layoutShifts: {
        supported: collector.layoutShiftSupported,
        count: collector.layoutShiftCount || 0,
        scoreSum: collector.layoutShiftSupported ? finiteScore(collector.layoutShiftScoreSum || 0) : null,
        recentInputCount: collector.layoutShiftRecentInputCount || 0,
        entries: [...layoutShifts]
          .sort((left, right) => right.value - left.value || left.startTimeMs - right.startTimeMs)
          .slice(0, config.maxReportedLayoutShifts),
        truncated: collector.layoutShiftsTruncated || layoutShifts.length > config.maxReportedLayoutShifts
      },
      caveats
    })
  }, config.settleMs))
}
