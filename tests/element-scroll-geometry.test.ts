import { describe, expect, it } from 'vitest'
import { normalizeElementInspection } from '../src/shared/element-inspection.js'

const geometry = { status: 'observed', scrollTop: 3.125, scrollLeft: -12.75, clientWidth: 120, clientHeight: 80, scrollWidth: 400, scrollHeight: 600, direction: 'rtl', writingMode: 'vertical-rl', isDocumentScroller: false, documentScroller: 'html' }
const report = (scrollGeometry?: unknown) => normalizeElementInspection({ tabId: 'tab', title: 'Fixture', url: 'https://example.test', raw: { selector: '#target', ...(scrollGeometry === undefined ? {} : { scrollGeometry }) } })

describe('bounded scroll geometry', () => {
  it('keeps default inspection unchanged and preserves physical signed subpixel offsets', () => {
    expect(report()).not.toHaveProperty('scrollGeometry')
    expect(report(geometry)).toHaveProperty('scrollGeometry', geometry)
  })
  it.each([NaN, Infinity, -Infinity, 1_000_000_001, -1_000_000_001, '42', null])('rejects incomplete/out-of-range offsets without clamping: %s', value => {
    expect(report({ ...geometry, scrollLeft: value })).toHaveProperty('scrollGeometry', { status: 'unavailable', reason: 'invalid-or-out-of-range' })
  })
  it.each(['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'])('rejects negative dimensions: %s', key => {
    expect(report({ ...geometry, [key]: -1 })).toHaveProperty('scrollGeometry.status', 'unavailable')
  })
  it('rejects incomplete or page-authored metadata and does not retain arbitrary data', () => {
    expect(report({ ...geometry, direction: { toString: () => 'rtl' } })).toHaveProperty('scrollGeometry.status', 'unavailable')
    expect(report({ ...geometry, direction: 'private-canary' })).toHaveProperty('scrollGeometry.status', 'unavailable')
    expect(report({ ...geometry, documentScroller: 'private-canary' })).toHaveProperty('scrollGeometry.status', 'unavailable')
    expect(report({ ...geometry, privateValue: 'private-canary' })).toHaveProperty('scrollGeometry', geometry)
    expect(report({ status: 'unavailable', reason: 'private-canary' })).toHaveProperty('scrollGeometry', { status: 'unavailable', reason: 'unsupported-cssom' })
  })
})
