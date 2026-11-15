import type { BrowserPerformanceSoftNavigations } from './types.js'
import { redactDiagnosticText } from './debug-report.js'

export function sanitizeSoftNavigations(value: BrowserPerformanceSoftNavigations): BrowserPerformanceSoftNavigations {
  const finite = (number: number): number | null => Number.isFinite(number) && number >= 0 ? number : null
  return {
    status: value.status,
    collectionStartTimeMs: finite(value.collectionStartTimeMs) ?? 0,
    historyComplete: false,
    maxNavigations: 2,
    truncated: value.truncated || value.navigations.length > 2,
    navigations: value.navigations.slice(-2).map(route => {
      let url = ''
      try {
        const parsed = new URL(route.url)
        if (['http:', 'https:'].includes(parsed.protocol)) {
          parsed.username = ''; parsed.password = ''; parsed.search = ''; parsed.hash = ''
          url = redactDiagnosticText(parsed.href).slice(0, 2_048)
        }
      } catch { /* Non-network URLs are omitted. */ }
      return {
        navigationId: /^\d{1,16}$/.test(route.navigationId) ? route.navigationId : '',
        navigationType: 'soft-navigation',
        url,
        startTimeMs: finite(route.startTimeMs) ?? 0,
        coverage: route.coverage,
        metrics: Object.fromEntries((['LCP', 'INP', 'CLS'] as const).map(name => {
          const metric = route.metrics[name]
          return [name, metric && finite(metric.value) !== null ? {
            name, value: metric.value, unit: name === 'CLS' ? 'score' : 'ms',
            rating: metric.rating
          } : null]
        })) as BrowserPerformanceSoftNavigations['navigations'][number]['metrics']
      }
    })
  }
}
