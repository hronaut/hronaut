import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { sanitizeSoftNavigations, softNavigationPageFunction } from '../src/shared/performance-soft-navigation.js'
import type { BrowserPerformanceSoftNavigations } from '../src/shared/types.js'

function collector(supported = true, method = true) {
  let entries: (list: { getEntries(): unknown[] }) => void = () => {}
  let restore: (event: { persisted: boolean }) => void = () => {}
  const callbacks: Record<string, (metric: unknown) => void> = {}
  let now = 100
  const registrations: unknown[] = []
  class Observer {
    static supportedEntryTypes = supported ? ['soft-navigation'] : []
    constructor(callback: typeof entries) { entries = callback }
    observe(options: unknown) { registrations.push(options) }
  }
  const read = runInNewContext(`(${softNavigationPageFunction})()`, {
    URL, PerformanceObserver: Observer,
    PerformanceSoftNavigation: { prototype: { getLargestInteractionContentfulPaint: method ? () => {} : undefined } },
    performance: { now: () => now },
    addEventListener: (_name: string, callback: typeof restore) => { restore = callback },
    webVitals: Object.fromEntries(['LCP', 'INP', 'CLS'].map(name => [`on${name}`, (callback: (metric: unknown) => void, options: unknown) => {
      callbacks[name] = callback
      registrations.push(options)
    }]))
  }) as () => BrowserPerformanceSoftNavigations
  return {
    read, registrations,
    route(id: number, startTime = id * 100, name = 'https://user:pass@example.test/route?token=private#fragment') {
      entries({ getEntries: () => [{ navigationId: id, startTime, name }] })
    },
    metric(id: number, name = 'LCP', value = 80, overrides = {}) {
      callbacks[name]?.({ name, value, rating: 'good', navigationType: 'soft-navigation', navigationId: id, navigationStartTime: id * 100, ...overrides })
    },
    restore(time: number) { now = time; restore({ persisted: true }) }
  }
}

describe('route-scoped performance evidence', () => {
  it.each([[false, true], [true, false]])('requires both unflagged capabilities (%s, %s)', (supported, method) => {
    const state = collector(supported, method)
    expect(state.read()).toMatchObject({ status: 'unsupported', navigations: [] })
    expect(state.registrations).toHaveLength(0)
  })
  it('waits for browser-observed navigation without fabricating zero metrics', () => {
    const state = collector()
    expect(state.read()).toMatchObject({ status: 'awaiting-navigation', historyComplete: false, collectionStartTimeMs: 100 })
    state.route(2)
    expect(state.read().navigations[0]).toMatchObject({ navigationId: '2', coverage: 'observed', metrics: { LCP: null, INP: null, CLS: null } })
  })
  it('associates delayed metrics with the originating navigation, including repeated URLs', () => {
    const state = collector()
    state.route(2); state.route(3)
    state.metric(2, 'INP', 160)
    state.metric(3, 'LCP', 240)
    expect(state.read().navigations.map(route => [route.navigationId, route.metrics.INP?.value, route.metrics.LCP?.value])).toEqual([
      ['2', 160, undefined], ['3', undefined, 240]
    ])
  })
  it('buffers metrics delivered before the route observer without inventing a navigation', () => {
    const state = collector()
    state.metric(2, 'LCP', 250)
    expect(state.read().navigations).toEqual([])
    state.route(2)
    expect(state.read().navigations[0]!.metrics.LCP?.value).toBe(250)
  })
  it('bounds pending callbacks and drops stale pre-restore callbacks', () => {
    const state = collector()
    for (let id = 2; id < 102; id++) state.metric(id)
    state.route(2)
    expect(state.read().navigations[0]!.metrics.LCP).toBeNull()
    state.route(101)
    expect(state.read().navigations.at(-1)!.metrics.LCP?.value).toBe(80)
    state.restore(20_000)
    state.route(201)
    state.metric(101)
    expect(state.read().navigations[0]!.metrics.LCP).toBeNull()
  })
  it('retains two routes and ignores callbacks for an evicted route', () => {
    const state = collector()
    for (let id = 2; id < 102; id++) state.route(id)
    state.metric(2)
    expect(state.read()).toMatchObject({ maxNavigations: 2, truncated: true })
    expect(state.read().navigations.map(route => route.navigationId)).toEqual(['100', '101'])
    expect(state.read().navigations.every(route => route.metrics.LCP === null)).toBe(true)
  })
  it('does not downgrade the current route when a stale entry is delivered', () => {
    const state = collector()
    state.route(3); state.route(4); state.route(2)
    expect(state.read().navigations.map(route => route.navigationId)).toEqual(['3', '4'])
  })
  it('marks buffered pre-attachment navigation as incomplete', () => {
    const state = collector()
    state.route(1, 30)
    expect(state.read()).toMatchObject({ status: 'incomplete', historyComplete: false })
    expect(state.read().navigations[0]!.coverage).toBe('incomplete')
    state.route(2)
    expect(state.read().status).toBe('observed')
  })
  it('does not use document metrics, invalid values, or mismatching navigation timing', () => {
    const state = collector()
    state.route(2)
    state.metric(2, 'LCP', 200, { navigationType: 'navigate' })
    state.metric(2, 'INP', 100, { navigationStartTime: 999 })
    state.metric(2, 'CLS', Number.NaN)
    expect(state.read().navigations[0]!.metrics).toEqual({ LCP: null, INP: null, CLS: null })
    state.metric(2, 'CLS', 0.00004)
    expect(state.read().navigations[0]!.metrics.CLS?.value).toBe(0.00004)
  })
  it('clears stale route evidence on BFCache restore and rejects earlier buffered entries', () => {
    const state = collector()
    state.route(2); state.metric(2)
    state.restore(500)
    state.route(3); state.metric(2)
    expect(state.read()).toMatchObject({ status: 'awaiting-navigation', collectionStartTimeMs: 500, navigations: [] })
    state.route(6)
    expect(state.read().navigations.map(route => route.navigationId)).toEqual(['6'])
  })
  it('does not duplicate observers or leak raw entries on repeated reads', () => {
    const state = collector()
    state.route(2); state.metric(2, 'LCP', 80, { entries: [{ content: 'private-content' }], attribution: { secret: 'private-content' } })
    for (let index = 0; index < 100; index++) state.read()
    expect(state.registrations).toHaveLength(4)
    const report = state.read()
    expect(report.navigations[0]!.url).toBe('https://example.test/route')
    expect(JSON.stringify(report)).not.toMatch(/private|user|pass|fragment|entries|attribution/)
  })
  it('re-sanitizes URLs and metric fields at the main-process boundary', () => {
    const state = collector()
    state.route(2); state.metric(2)
    const report = state.read()
    report.navigations[0]!.url = 'https://user:pass@example.test/a?secret=private#fragment'
    Object.assign(report.navigations[0]!.metrics.LCP!, { entries: ['private'] })
    const safe = sanitizeSoftNavigations(report)
    expect(safe.navigations[0]!.url).toBe('https://example.test/a')
    expect(JSON.stringify(safe)).not.toMatch(/private|user|pass|fragment|entries/)
  })
})
