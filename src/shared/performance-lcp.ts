import type { BrowserPerformanceLcpAttribution } from './types.js'
import { redactDiagnosticText } from './debug-report.js'

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
