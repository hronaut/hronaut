import { describe, expect, it } from 'vitest'
import {
  MAX_SERVER_TIMING_METRICS,
  parseServerTimingHeaders,
  serializeServerTimingMetrics
} from '../src/shared/server-timing.js'

describe('Server-Timing parsing', () => {
  it('preserves repeated metrics and quoted delimiters from repeated headers', () => {
    expect(parseServerTimingHeaders({
      'Server-Timing': [
        'db;dur=53.27;desc="Primary, read; replica", cache;desc="Miss"',
        'db;dur=12, app;dur=47.26'
      ]
    })).toEqual([
      { name: 'db', durationMs: 53.3, description: 'Primary, read; replica' },
      { name: 'cache', description: 'Miss' },
      { name: 'db', durationMs: 12 },
      { name: 'app', durationMs: 47.3 }
    ])
  })

  it('uses only the first known parameter and ignores extensions or trailing quoted text', () => {
    expect(parseServerTimingHeaders({
      'server-timing': 'edge;foo=kept;dur=4.2;dur=99;desc="CDN \\"warm\\"" ignored;desc=second, invalid name;dur=1'
    })).toEqual([
      { name: 'edge', durationMs: 4.2, description: 'CDN "warm"' }
    ])
    expect(parseServerTimingHeaders({ 'server-timing': 'db;dur=invalid;dur=8' })).toEqual([{ name: 'db' }])
  })

  it('sanitizes descriptions and bounds the number of metrics', () => {
    const header = Array.from({ length: MAX_SERVER_TIMING_METRICS + 5 }, (_, index) => (
      `metric${index};dur=${index};desc="token=private"`
    )).join(',')
    const metrics = parseServerTimingHeaders({ 'SERVER-TIMING': header })
    expect(metrics).toHaveLength(MAX_SERVER_TIMING_METRICS)
    expect(metrics[0]).toEqual({ name: 'metric0', durationMs: 0, description: 'token=[REDACTED]' })
    expect(parseServerTimingHeaders(undefined)).toEqual([])
  })

  it('serializes only normalized metrics for safe request-detail headers', () => {
    expect(serializeServerTimingMetrics([
      { name: 'db', durationMs: 12.3, description: 'Primary "read" \\ replica' },
      { name: 'cache', description: 'Miss' }
    ])).toBe('db;dur=12.3;desc="Primary \\"read\\" \\\\ replica", cache;desc="Miss"')
  })
})
