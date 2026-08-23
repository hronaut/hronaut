import { describe, expect, it } from 'vitest'
import {
  buildNetworkWaterfallRange,
  networkRequestDurationMs,
  networkWaterfallPosition
} from '../src/shared/network-waterfall.js'
import type { BrowserNetworkRequest } from '../src/shared/types.js'

function request(
  id: string,
  startedAt: string,
  durationMs?: number,
  completedAt?: string
): BrowserNetworkRequest {
  return {
    id,
    url: `https://example.test/${id}`,
    method: 'GET',
    resourceType: 'fetch',
    startedAt,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(completedAt ? { completedAt } : {}),
    detailsAvailable: true
  }
}

describe('network waterfall', () => {
  it('scales visible requests against their shared start and end range', () => {
    const first = request('first', '2026-08-15T10:00:00.000Z', 100)
    const second = request('second', '2026-08-15T10:00:00.050Z', 200)
    const range = buildNetworkWaterfallRange([first, second])

    expect(range).toEqual({ startMs: Date.parse(first.startedAt), spanMs: 250 })
    expect(networkWaterfallPosition(first, range)).toMatchObject({
      startOffsetMs: 0,
      durationMs: 100,
      leftPercent: 0,
      widthPercent: 40,
      pending: false
    })
    expect(networkWaterfallPosition(second, range)).toMatchObject({
      startOffsetMs: 50,
      durationMs: 200,
      leftPercent: 20,
      widthPercent: 80,
      pending: false
    })
  })

  it('falls back to completion timestamps when a measured duration is unavailable', () => {
    const completed = request(
      'completed',
      '2026-08-15T10:00:00.000Z',
      undefined,
      '2026-08-15T10:00:00.125Z'
    )

    expect(networkRequestDurationMs(completed)).toBe(125)
    expect(buildNetworkWaterfallRange([completed])).toEqual({
      startMs: Date.parse(completed.startedAt),
      spanMs: 125
    })
  })

  it('marks incomplete requests at their relative start without inventing a duration', () => {
    const first = request('first', '2026-08-15T10:00:00.000Z', 200)
    const pending = request('pending', '2026-08-15T10:00:00.100Z')
    const position = networkWaterfallPosition(pending, buildNetworkWaterfallRange([first, pending]))

    expect(position).toMatchObject({
      startOffsetMs: 100,
      leftPercent: 50,
      widthPercent: 0,
      pending: true
    })
    expect(position).not.toHaveProperty('durationMs')
  })

  it('ignores invalid starts and keeps a late zero-duration marker inside the track', () => {
    const invalid = request('invalid', 'not-a-date', 100)
    const first = request('first', '2026-08-15T10:00:00.000Z', 100)
    const last = request('last', '2026-08-15T10:00:00.100Z', 0)
    const range = buildNetworkWaterfallRange([invalid, first, last])
    const position = networkWaterfallPosition(last, range)

    expect(buildNetworkWaterfallRange([invalid])).toBeUndefined()
    expect(networkWaterfallPosition(invalid, range)).toBeUndefined()
    expect(position).toMatchObject({ leftPercent: 98.75, widthPercent: 1.25 })
    expect((position?.leftPercent ?? 0) + (position?.widthPercent ?? 0)).toBeLessThanOrEqual(100)
  })
})
