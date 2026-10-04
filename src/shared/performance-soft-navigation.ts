import type { BrowserPerformanceSoftNavigations } from './types.js'
import { redactDiagnosticText } from './debug-report.js'

// Runs in the isolated performance world. Keep document metrics on their existing
// observers; only this additional collector opts into per-navigation semantics.
export const softNavigationPageFunction = `() => {
  const startedAt = performance.now();
  let collectionStartTimeMs = startedAt;
  const routes = [];
  const pending = [];
  let truncated = false;
  let supported = false;
  const finite = value => Number.isFinite(value) && value >= 0 ? value : null;
  const safeUrl = value => {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      url.username = ''; url.password = ''; url.search = ''; url.hash = '';
      return url.href.slice(0, 2048);
    } catch { return ''; }
  };
  const key = value => Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  const update = metric => {
    if (metric?.navigationType !== 'soft-navigation' || !['LCP', 'INP', 'CLS'].includes(metric.name)) return;
    const navigationId = key(metric.navigationId);
    const startTimeMs = finite(metric.navigationStartTime);
    const value = finite(metric.value);
    if (!navigationId || startTimeMs === null || value === null) return;
    if (collectionStartTimeMs !== startedAt && startTimeMs < collectionStartTimeMs) return;
    const route = routes.find(route => route.navigationId === navigationId);
    const summary = {
      name: metric.name, value, unit: metric.name === 'CLS' ? 'score' : 'ms',
      rating: ['good', 'needs-improvement', 'poor'].includes(metric.rating) ? metric.rating : 'needs-improvement'
    };
    if (route) {
      if (startTimeMs === route.startTimeMs) route.metrics[metric.name] = summary;
      return;
    }
    // PerformanceObserver delivery order is not guaranteed. Keep at most two
    // sanitized pending identities until the browser's route observer runs;
    // callbacks alone never create a reported navigation.
    if (routes.length === 2 && startTimeMs < routes[0].startTimeMs) return;
    let entry = pending.find(entry => entry.navigationId === navigationId);
    if (!entry) {
      entry = { navigationId, startTimeMs, metrics: {} };
      pending.push(entry);
      pending.sort((left, right) => left.startTimeMs - right.startTimeMs);
      if (pending.length > 2) pending.splice(0, pending.length - 2);
    }
    if (entry.startTimeMs === startTimeMs) entry.metrics[metric.name] = summary;
  };
  try {
    if (PerformanceObserver.supportedEntryTypes.includes('soft-navigation') &&
        typeof globalThis.PerformanceSoftNavigation?.prototype?.getLargestInteractionContentfulPaint === 'function') {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const navigationId = key(entry.navigationId);
          const startTimeMs = finite(entry.startTime);
          if (!navigationId || startTimeMs === null || routes.some(route => route.navigationId === navigationId)) continue;
          if (collectionStartTimeMs !== startedAt && startTimeMs < collectionStartTimeMs) continue;
          const pendingIndex = pending.findIndex(entry => entry.navigationId === navigationId);
          const buffered = pendingIndex < 0 ? undefined : pending.splice(pendingIndex, 1)[0];
          routes.push({ navigationId, navigationType: 'soft-navigation', url: safeUrl(entry.name), startTimeMs,
            coverage: startTimeMs < collectionStartTimeMs ? 'incomplete' : 'observed',
            metrics: { LCP: null, INP: null, CLS: null, ...(buffered?.startTimeMs === startTimeMs ? buffered.metrics : {}) } });
          routes.sort((left, right) => left.startTimeMs - right.startTimeMs);
          if (routes.length > 2) { routes.splice(0, routes.length - 2); truncated = true; }
        }
      });
      observer.observe({ type: 'soft-navigation', buffered: true });
      // The separate identity observer also reports routes with no metric yet.
      for (const name of ['LCP', 'INP', 'CLS']) {
        globalThis.webVitals['on' + name](update, { reportSoftNavs: true, reportAllChanges: true });
      }
      supported = true;
      addEventListener('pageshow', event => {
        if (!event.persisted) return;
        routes.length = 0;
        pending.length = 0;
        truncated = false;
        collectionStartTimeMs = performance.now();
      });
    }
  } catch { supported = false; }
  return () => ({
    status: !supported ? 'unsupported' : routes.length === 0 ? 'awaiting-navigation'
      : routes[routes.length - 1].coverage === 'incomplete' ? 'incomplete' : 'observed',
    collectionStartTimeMs, historyComplete: false, maxNavigations: 2, truncated,
    navigations: supported ? routes.map(route => ({ ...route, metrics: { ...route.metrics } })) : []
  });
}`

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
