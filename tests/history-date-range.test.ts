import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// Fresh processes make system timezone changes deterministic on every runner.
function bounds(zone: string, range: string, now: string): string[] | null {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { historyDateBounds } from './src/renderer/src/composables/history-date-range.ts'
    console.log(JSON.stringify(historyDateBounds(${JSON.stringify(range)}, Date.parse(${JSON.stringify(now)}))?.map(value => new Date(value).toISOString()) ?? null))
  `], { env: { ...process.env, TZ: zone }, encoding: 'utf8' })) as string[] | null
}

describe('history local calendar ranges', () => {
  it.each([
    ['America/New_York', '2026-03-08T17:00:00Z', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    ['America/New_York', '2026-11-01T17:00:00Z', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
    ['America/Sao_Paulo', '2018-11-04T17:00:00Z', '2018-11-04T03:00:00.000Z', '2018-11-05T02:00:00.000Z'],
    ['Asia/Kathmandu', '2026-01-01T01:00:00Z', '2025-12-31T18:15:00.000Z', '2026-01-01T18:15:00.000Z'],
    ['Pacific/Honolulu', '2026-01-01T01:00:00Z', '2025-12-31T10:00:00.000Z', '2026-01-01T10:00:00.000Z']
  ])('uses local midnight in %s at %s', (zone, now, start, end) => {
    expect(bounds(zone, 'today', now)).toEqual([start, end])
  })

  it.each([
    ['2026-03-10T17:00:00Z', '2026-03-04T05:00:00.000Z', '2026-03-11T04:00:00.000Z'],
    ['2026-11-03T17:00:00Z', '2026-10-28T04:00:00.000Z', '2026-11-04T05:00:00.000Z'],
    ['2026-01-03T17:00:00Z', '2025-12-28T05:00:00.000Z', '2026-01-04T05:00:00.000Z']
  ])('includes today and six preceding dates at %s', (now, start, end) => {
    expect(bounds('America/New_York', 'last7Days', now)).toEqual([start, end])
  })

  it('leaves All unbounded', () => {
    expect(bounds('UTC', 'all', '2026-10-07T12:00:00Z')).toBeNull()
  })

  it('does not carry a skipped midnight hour into other days in the week', () => {
    expect(bounds('America/Sao_Paulo', 'last7Days', '2018-11-04T17:00:00Z'))
      .toEqual(['2018-10-29T03:00:00.000Z', '2018-11-05T02:00:00.000Z'])
  })
})
