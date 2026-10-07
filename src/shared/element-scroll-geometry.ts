import type { BrowserScrollGeometry } from './types.js'

export const MAX_SCROLL_GEOMETRY_PX = 1_000_000_000

export function normalizeScrollGeometry(value: unknown): BrowserScrollGeometry {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (raw.status !== 'observed') return { status: 'unavailable', reason: 'unsupported-cssom' }
  const keys = ['scrollTop', 'scrollLeft', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'] as const
  if (keys.some(key => typeof raw[key] !== 'number' || !Number.isFinite(raw[key])
    || Math.abs(raw[key]) > MAX_SCROLL_GEOMETRY_PX || (key !== 'scrollTop' && key !== 'scrollLeft' && raw[key] < 0))
    || (raw.direction !== 'ltr' && raw.direction !== 'rtl')
    || typeof raw.writingMode !== 'string'
    || !['horizontal-tb', 'vertical-rl', 'vertical-lr', 'sideways-rl', 'sideways-lr'].includes(raw.writingMode)
    || typeof raw.isDocumentScroller !== 'boolean'
    || ![null, 'html', 'body'].includes(raw.documentScroller as string | null)) {
    return { status: 'unavailable', reason: 'invalid-or-out-of-range' }
  }
  return {
    status: 'observed',
    scrollTop: raw.scrollTop as number,
    scrollLeft: raw.scrollLeft as number,
    clientWidth: raw.clientWidth as number,
    clientHeight: raw.clientHeight as number,
    scrollWidth: raw.scrollWidth as number,
    scrollHeight: raw.scrollHeight as number,
    direction: raw.direction as 'ltr' | 'rtl',
    writingMode: raw.writingMode as Extract<BrowserScrollGeometry, { status: 'observed' }>['writingMode'],
    isDocumentScroller: raw.isDocumentScroller,
    documentScroller: raw.documentScroller as 'html' | 'body' | null
  }
}
