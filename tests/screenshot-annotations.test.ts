import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { annotateScreenshotBitmap, normalizeScreenshotRefs, screenshotAnnotationScript } from '../src/shared/screenshot-annotations.js'

describe('selected screenshot labels', () => {
  it('is opt-in, bounded, validates canonical refs and deduplicates', () => {
    expect(normalizeScreenshotRefs(undefined)).toBeUndefined()
    expect(normalizeScreenshotRefs(['e1', 'e1', 'e20'])).toEqual(['e1', 'e20'])
    for (const value of [[], ['e0'], ['e1000000'], ['private-text'], Array(51).fill('e1'), 'e1', null]) {
      expect(() => normalizeScreenshotRefs(value)).toThrow('1 to 50')
    }
  })
  const draw = (rows: unknown, refs = ['e1']) => {
    const bitmap = new Uint8Array(200 * 100 * 4).fill(255)
    return { bitmap, report: annotateScreenshotBitmap(bitmap, 200, 100, { width: 400, height: 200 }, refs, rows) }
  }
  it('maps clipped CSS geometry into final image pixels and draws only bounded opaque labels', () => {
    const { report, bitmap } = draw([{ ref: 'e1', status: 'visible', rect: { x: -20, y: 40, width: 100, height: 60 }, secret: 'private-canary' }])
    expect(report.annotations[0]).toMatchObject({ label: 1, status: 'labeled', clipped: true, bounds: { x: 0, y: 20, width: 40, height: 30 } })
    expect(Array.from(bitmap.slice((20 * 200) * 4, (20 * 200) * 4 + 4))).toEqual([0, 220, 255, 255])
    expect(Array.from(bitmap.slice((99 * 200 + 199) * 4, (99 * 200 + 199) * 4 + 4))).toEqual([255, 255, 255, 255])
    expect(JSON.stringify(report)).not.toContain('private-canary')
  })
  it('reports missing, unsupported, ambiguous and changed targets without drawing them', () => {
    for (const status of ['missing', 'unsupported', 'ambiguous', 'hidden', 'changed', 'moved']) {
      const { report, bitmap } = draw([{ ref: 'e1', status }])
      expect(report.annotations[0]).toEqual({ ref: 'e1', label: 1, status })
      expect(bitmap.every(byte => byte === 255)).toBe(true)
    }
  })
  it('does not rebound mismatched records, invalid geometry or offscreen targets', () => {
    for (const row of [{ ref: 'e2', status: 'visible' }, { ref: 'e1', status: 'visible', rect: { x: 0, y: 0, width: Infinity, height: 1 } }]) expect(draw([row]).report.annotations[0]!.status).toBe('unsupported')
    expect(draw([{ ref: 'e1', status: 'visible', rect: { x: 500, y: 0, width: 20, height: 20 } }]).report.annotations[0]!.status).toBe('offscreen')
  })
  it('keeps overlapping labels distinct or explicitly omits them', () => {
    const refs = Array.from({ length: 50 }, (_, index) => `e${index + 1}`)
    const { report } = draw(refs.map(ref => ({ ref, status: 'visible', rect: { x: 40, y: 40, width: 40, height: 30 } })), refs)
    const boxes = report.annotations.flatMap(row => row.labelBounds ? [row.labelBounds] : [])
    expect(report.annotations.some(row => row.status === 'label-overlap')).toBe(true)
    for (const [index, a] of boxes.entries()) for (const b of boxes.slice(index + 1)) expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false)
    expect(JSON.stringify(report).length).toBeLessThan(20_000)
  })
  it('rejects invalid or excessive bitmap layouts', () => {
    expect(() => annotateScreenshotBitmap(new Uint8Array(4), 100, 100, { width: 100, height: 100 }, ['e1'], [])).toThrow('align')
    expect(() => annotateScreenshotBitmap(new Uint8Array(4), 1, 1, { width: NaN, height: 1 }, ['e1'], [])).toThrow('align')
  })
  it('pins identity, bounds concurrent captures, expires even if timers are throttled, and cleans up', () => {
    let now = 0
    const node = { isConnected: true, matches: () => false, closest: () => null, checkVisibility: () => true,
      getBoundingClientRect: () => ({ x: 1, y: 1, width: 10, height: 10 }) }
    let matches = [node]
    const context = { document: { querySelectorAll: () => matches }, getComputedStyle: () => ({ display: 'block' }),
      Date: { now: () => now }, setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() }
    const run = (id: string, refs?: string[], cleanup = false) => runInNewContext(screenshotAnnotationScript(id, refs, cleanup), context)
    for (let i = 0; i < 4; i++) run(String(i), ['e1'])
    expect(() => run('excess', ['e1'])).toThrow('Too many')
    matches = [{ ...node }]
    expect(run('0')[0].status).toBe('changed')
    run('1', undefined, true)
    expect(() => run('1')).toThrow('expired')
    now = 10_000
    expect(() => run('2')).toThrow('expired')
    expect(run('fresh', ['e1'])[0].status).toBe('visible')
    expect(run('fresh')[0].status).toBe('visible')
    expect(context.clearTimeout).toHaveBeenCalled()
  })
})
