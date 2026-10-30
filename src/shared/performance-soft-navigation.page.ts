import type { BrowserPerformanceSoftNavigations } from './types.js'

type SoftNavigationMetricName = 'LCP' | 'INP' | 'CLS'
type SoftNavigationRoute = BrowserPerformanceSoftNavigations['navigations'][number]
type SoftNavigationSummary = NonNullable<SoftNavigationRoute['metrics'][SoftNavigationMetricName]>

/** The parts of a web-vitals metric reported for a soft navigation that the page reads. */
interface SoftNavigationMetric {
  name: string
  value: number
  rating: string
  navigationType: string
  navigationId: unknown
  navigationStartTime: number
}

type SoftNavigationPage = typeof globalThis & {
  PerformanceSoftNavigation?: { prototype?: { getLargestInteractionContentfulPaint?: unknown } }
  webVitals: Record<string, (callback: (metric: SoftNavigationMetric) => void, options: { reportSoftNavs: boolean; reportAllChanges: boolean }) => void>
}

/**
 * Runs in the isolated performance world, after web-vitals: starts collecting the metrics of up to two soft
 * navigations, and returns the function that reads them. Document metrics stay on their existing observers; only this
 * additional collector opts into per-navigation semantics.
 */
export function softNavigationsInPage(): () => BrowserPerformanceSoftNavigations {
  const page = globalThis as SoftNavigationPage
  const startedAt = performance.now()
  let collectionStartTimeMs = startedAt
  const routes: SoftNavigationRoute[] = []
  const pending: Array<{ navigationId: string; startTimeMs: number; metrics: Partial<Record<SoftNavigationMetricName, SoftNavigationSummary>> }> = []
  let truncated = false
  let supported = false
  const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
  const safeUrl = (value: string): string => {
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) return ''
      url.username = ''; url.password = ''; url.search = ''; url.hash = ''
      return url.href.slice(0, 2048)
    } catch { return '' }
  }
  const key = (value: unknown): string | null => Number.isSafeInteger(value) && (value as number) > 0 ? String(value) : null
  const update = (metric: SoftNavigationMetric | undefined): void => {
    if (metric?.navigationType !== 'soft-navigation' || !['LCP', 'INP', 'CLS'].includes(metric.name)) return
    const name = metric.name as SoftNavigationMetricName
    const navigationId = key(metric.navigationId)
    const startTimeMs = finite(metric.navigationStartTime)
    const value = finite(metric.value)
    if (!navigationId || startTimeMs === null || value === null) return
    if (collectionStartTimeMs !== startedAt && startTimeMs < collectionStartTimeMs) return
    const route = routes.find(route => route.navigationId === navigationId)
    const summary: SoftNavigationSummary = {
      name, value, unit: name === 'CLS' ? 'score' : 'ms',
      rating: ['good', 'needs-improvement', 'poor'].includes(metric.rating) ? metric.rating as SoftNavigationSummary['rating'] : 'needs-improvement'
    }
    if (route) {
      if (startTimeMs === route.startTimeMs) route.metrics[name] = summary
      return
    }
    // PerformanceObserver delivery order is not guaranteed. Keep at most two
    // sanitized pending identities until the browser's route observer runs;
    // callbacks alone never create a reported navigation.
    if (routes.length === 2 && startTimeMs < routes[0]!.startTimeMs) return
    let entry = pending.find(entry => entry.navigationId === navigationId)
    if (!entry) {
      entry = { navigationId, startTimeMs, metrics: {} }
      pending.push(entry)
      pending.sort((left, right) => left.startTimeMs - right.startTimeMs)
      if (pending.length > 2) pending.splice(0, pending.length - 2)
    }
    if (entry.startTimeMs === startTimeMs) entry.metrics[name] = summary
  }
  try {
    if (PerformanceObserver.supportedEntryTypes.includes('soft-navigation') &&
        typeof page.PerformanceSoftNavigation?.prototype?.getLargestInteractionContentfulPaint === 'function') {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { navigationId?: unknown }>) {
          const navigationId = key(entry.navigationId)
          const startTimeMs = finite(entry.startTime)
          if (!navigationId || startTimeMs === null || routes.some(route => route.navigationId === navigationId)) continue
          if (collectionStartTimeMs !== startedAt && startTimeMs < collectionStartTimeMs) continue
          const pendingIndex = pending.findIndex(entry => entry.navigationId === navigationId)
          const buffered = pendingIndex < 0 ? undefined : pending.splice(pendingIndex, 1)[0]
          routes.push({ navigationId, navigationType: 'soft-navigation', url: safeUrl(entry.name), startTimeMs,
            coverage: startTimeMs < collectionStartTimeMs ? 'incomplete' : 'observed',
            metrics: { LCP: null, INP: null, CLS: null, ...(buffered?.startTimeMs === startTimeMs ? buffered.metrics : {}) } })
          routes.sort((left, right) => left.startTimeMs - right.startTimeMs)
          if (routes.length > 2) { routes.splice(0, routes.length - 2); truncated = true }
        }
      })
      observer.observe({ type: 'soft-navigation', buffered: true })
      // The separate identity observer also reports routes with no metric yet.
      for (const name of ['LCP', 'INP', 'CLS']) {
        page.webVitals['on' + name]!(update, { reportSoftNavs: true, reportAllChanges: true })
      }
      supported = true
      addEventListener('pageshow', event => {
        if (!event.persisted) return
        routes.length = 0
        pending.length = 0
        truncated = false
        collectionStartTimeMs = performance.now()
      })
    }
  } catch { supported = false }
  return () => ({
    status: !supported ? 'unsupported' : routes.length === 0 ? 'awaiting-navigation'
      : routes[routes.length - 1]!.coverage === 'incomplete' ? 'incomplete' : 'observed',
    collectionStartTimeMs, historyComplete: false, maxNavigations: 2, truncated,
    navigations: supported ? routes.map(route => ({ ...route, metrics: { ...route.metrics } })) : []
  })
}
