import type { BrowserPerformanceLcpAttribution } from './types.js'
import { redactDiagnosticText } from './debug-report.js'

// Executed inside the existing isolated performance collector. Never return the
// library's attribution object: it contains DOM nodes and raw PerformanceEntries.
export const lcpAttributionPageFunction = `(metric) => {
  const a = metric.attribution || {};
  const entry = a.lcpEntry;
  const finite = value => Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
  const result = {
    status: 'incomplete', reason: 'missing-candidate', resourceTiming: 'missing',
    candidateTimeMs: finite(entry?.startTime), timeToFirstByteMs: null,
    resourceLoadDelayMs: null, resourceLoadDurationMs: null, elementRenderDelayMs: null
  };
  if (typeof a.target === 'string' && a.target) result.target = a.target.slice(0, 500);
  try {
    const url = new URL(entry?.url);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.username = ''; url.password = ''; url.search = ''; url.hash = '';
      result.resourceUrl = url.href.slice(0, 2048);
    }
  } catch { /* Non-network and missing URLs are not exported. */ }
  if (!['navigate', 'reload'].includes(metric.navigationType)) {
    return { ...result, status: 'unsupported', reason: 'unsupported-navigation' };
  }
  if (!entry || finite(metric.value) === null || result.candidateTimeMs === null) return result;
  if (Math.abs(entry.startTime - metric.value) > 1) return { ...result, reason: 'inconsistent-timing' };
  const navigation = a.navigationEntry;
  if (!navigation || !(navigation.responseStart > 0)) return { ...result, reason: 'missing-navigation' };
  result.timeToFirstByteMs = finite(a.timeToFirstByte);
  const tag = entry.element?.localName;
  const hasResource = Boolean(entry.url) || ['img', 'video', 'image'].includes(tag);
  if (hasResource) {
    const resource = a.lcpResourceEntry;
    if (!resource) return { ...result, reason: 'missing-resource' };
    if (resource.name !== entry.url || resource.startTime > entry.startTime) {
      return { ...result, reason: 'inconsistent-timing' };
    }
    if (!(resource.requestStart > 0) || !(resource.responseStart > 0) || !(entry.renderTime > 0)) {
      return { ...result, resourceTiming: 'restricted', reason: 'restricted-timing' };
    }
    result.resourceTiming = 'observed';
  } else {
    // A removed/unknown candidate must not silently become text LCP.
    if (!entry.element) return result;
    result.resourceTiming = 'not-applicable';
  }
  const phases = [a.timeToFirstByte, a.resourceLoadDelay, a.resourceLoadDuration, a.elementRenderDelay];
  if (phases.some(value => finite(value) === null) || Math.abs(phases.reduce((sum, value) => sum + value, 0) - metric.value) > 1) {
    return { ...result, reason: 'inconsistent-timing' };
  }
  return {
    ...result, status: 'complete', reason: undefined,
    resourceLoadDelayMs: finite(a.resourceLoadDelay),
    resourceLoadDurationMs: finite(a.resourceLoadDuration),
    elementRenderDelayMs: finite(a.elementRenderDelay)
  };
}`

export function sanitizeLcpAttribution(value: BrowserPerformanceLcpAttribution): BrowserPerformanceLcpAttribution {
  const finite = (number: number | null): number | null => Number.isFinite(number) && number !== null && number >= 0 ? number : null
  const target = typeof value.target === 'string'
    ? redactDiagnosticText(value.target).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500)
    : undefined
  let resourceUrl: string | undefined
  try {
    const url = new URL(value.resourceUrl ?? '')
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.username = ''; url.password = ''; url.search = ''; url.hash = ''
      resourceUrl = url.href.slice(0, 2_048)
    }
  } catch { /* Omit invalid resource URLs. */ }
  return {
    status: value.status,
    ...(value.reason ? { reason: value.reason } : {}),
    resourceTiming: value.resourceTiming,
    candidateTimeMs: finite(value.candidateTimeMs),
    timeToFirstByteMs: finite(value.timeToFirstByteMs),
    resourceLoadDelayMs: finite(value.resourceLoadDelayMs),
    resourceLoadDurationMs: finite(value.resourceLoadDurationMs),
    elementRenderDelayMs: finite(value.elementRenderDelayMs),
    ...(target ? { target } : {}),
    ...(resourceUrl ? { resourceUrl } : {})
  }
}
