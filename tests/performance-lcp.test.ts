import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { lcpAttributionPageFunction, sanitizeLcpAttribution } from '../src/shared/performance-lcp.js'
import type { BrowserPerformanceLcpAttribution } from '../src/shared/types.js'

function fixture() {
  return {
    value: 1_000, navigationType: 'navigate',
    attribution: {
      target: '#hero', url: 'https://ignored.example/wrong-candidate',
      timeToFirstByte: 100, resourceLoadDelay: 200, resourceLoadDuration: 300, elementRenderDelay: 400,
      navigationEntry: { responseStart: 100 },
      lcpEntry: { startTime: 1_000, renderTime: 1_000, url: 'https://user:pass@example.test/hero.png?token=private#fragment', element: { localName: 'img' } },
      lcpResourceEntry: { name: 'https://user:pass@example.test/hero.png?token=private#fragment', startTime: 280, requestStart: 300, responseStart: 310 }
    }
  }
}
function summarize(metric: unknown): BrowserPerformanceLcpAttribution {
  return runInNewContext(`(${lcpAttributionPageFunction})(metric)`, { metric, URL }) as BrowserPerformanceLcpAttribution
}

describe('bounded LCP phase attribution', () => {
  it('returns only same-candidate phases and sanitized resource/target metadata', () => {
    const value = summarize(fixture())
    expect(value).toEqual({ status: 'complete', reason: undefined, resourceTiming: 'observed', candidateTimeMs: 1_000,
      timeToFirstByteMs: 100, resourceLoadDelayMs: 200, resourceLoadDurationMs: 300, elementRenderDelayMs: 400,
      target: '#hero', resourceUrl: 'https://example.test/hero.png' })
    expect(JSON.stringify(value)).not.toMatch(/private|pass|ignored|lcpEntry|localName|navigationEntry/)
  })
  it('marks text resource phases as not applicable', () => {
    const metric = fixture()
    metric.attribution.lcpEntry.url = ''
    metric.attribution.lcpEntry.element.localName = 'p'
    metric.attribution.resourceLoadDelay = 0
    metric.attribution.resourceLoadDuration = 0
    metric.attribution.elementRenderDelay = 900
    expect(summarize(metric)).toMatchObject({ status: 'complete', resourceTiming: 'not-applicable', resourceLoadDelayMs: 0, resourceLoadDurationMs: 0 })
  })
  it.each(['back-forward', 'back-forward-cache', 'prerender', 'restore', 'soft-navigation'])('does not invent phases for %s', navigationType => {
    expect(summarize({ ...fixture(), navigationType })).toMatchObject({ status: 'unsupported', reason: 'unsupported-navigation', timeToFirstByteMs: null, resourceLoadDurationMs: null })
  })
  it.each([
    ['missing-candidate', { lcpEntry: undefined }],
    ['missing-navigation', { navigationEntry: undefined }],
    ['missing-resource', { lcpResourceEntry: undefined }],
    ['restricted-timing', { lcpResourceEntry: { ...fixture().attribution.lcpResourceEntry, requestStart: 0 } }],
    ['restricted-timing', { lcpEntry: { ...fixture().attribution.lcpEntry, renderTime: 0 } }],
    ['inconsistent-timing', { lcpResourceEntry: { ...fixture().attribution.lcpResourceEntry, startTime: 1_500 } }],
    ['inconsistent-timing', { lcpResourceEntry: { ...fixture().attribution.lcpResourceEntry, name: 'https://different.example/' } }],
    ['inconsistent-timing', { elementRenderDelay: 123 }],
    ['inconsistent-timing', { resourceLoadDuration: Number.NaN }],
    ['inconsistent-timing', { resourceLoadDelay: -1 }]
  ])('reports incomplete evidence: %s', (reason, attribution) => {
    const metric = fixture()
    expect(summarize({ ...metric, attribution: { ...metric.attribution, ...attribution } })).toMatchObject({ status: 'incomplete', reason, resourceLoadDurationMs: null, elementRenderDelayMs: null })
  })
  it('does not classify a removed unknown candidate as text', () => {
    const metric = fixture()
    expect(summarize({ ...metric, attribution: { ...metric.attribution, lcpEntry: { startTime: 1_000, url: '', element: null } } })).toMatchObject({ status: 'incomplete', resourceTiming: 'missing' })
  })
  it('bounds metadata and excludes raw library objects at the main-process boundary', () => {
    const value = sanitizeLcpAttribution({ ...summarize(fixture()), target: '#secret token=private ' + 'x'.repeat(1_000),
      resourceUrl: 'https://user:pass@example.test/hero.png?token=private#fragment',
      lcpEntry: { outerHTML: '<input value="private">' } } as BrowserPerformanceLcpAttribution)
    expect(value.target!.length).toBeLessThanOrEqual(500)
    expect(value.resourceUrl).toBe('https://example.test/hero.png')
    expect(JSON.stringify(value)).not.toMatch(/private|pass|outerHTML|lcpEntry/)
  })
})
