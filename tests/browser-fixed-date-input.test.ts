import { expect, it } from 'vitest'
import { stagedEpochMs } from '../src/main/mcp/tools/browser-fixed-date/index.js'

it('reads an ISO 8601 instant with Z or a UTC offset, or epoch milliseconds', () => {
  expect(stagedEpochMs('2026-12-31T23:59:30Z', undefined)).toBe(Date.UTC(2026, 11, 31, 23, 59, 30))
  expect(stagedEpochMs('2026-12-31T23:59Z', undefined)).toBe(Date.UTC(2026, 11, 31, 23, 59))
  expect(stagedEpochMs('2026-12-31T23:59:30.5Z', undefined)).toBe(Date.UTC(2026, 11, 31, 23, 59, 30, 500))
  expect(stagedEpochMs('2027-01-01T00:00:00-05:00', undefined)).toBe(Date.UTC(2027, 0, 1, 5))
  expect(stagedEpochMs('2026-03-29T03:30:00+05:30', undefined)).toBe(Date.UTC(2026, 2, 28, 22))
  expect(stagedEpochMs('2028-02-29T12:00:00Z', undefined)).toBe(Date.UTC(2028, 1, 29, 12))
  expect(stagedEpochMs(undefined, 0)).toBe(0)
  // A two-digit year stays in the first century instead of becoming 1999.
  expect(stagedEpochMs('0099-01-01T00:00Z', undefined)).toBe(Date.parse('0099-01-01T00:00Z'))
})

it('refuses dates and times that do not exist instead of rolling them over', () => {
  for (const at of [
    '2026-02-29T09:00Z', '2026-04-31T00:00Z', '2026-13-01T00:00Z', '2026-12-31T24:00:00Z',
    '2026-12-31T23:60Z', '2026-12-31T23:59:60Z', '2026-12-31T23:59Z+24:00', '2026-12-31T23:59+05:60',
    '2026-12-31', '2026-12-31T23:59:30', '31/12/2026 23:59', '+275760-09-13T00:00:00Z'
  ]) expect(() => stagedEpochMs(at, undefined), at).toThrow('at must be an existing date and time')
  expect(() => stagedEpochMs('2026-12-31T23:59:30Z', 0)).toThrow('exactly one')
  expect(() => stagedEpochMs(undefined, undefined)).toThrow('exactly one')
})
