export type HistoryDateRange = 'all' | 'today' | 'last7Days'

/** Shell-local calendar days, independent of website timezone emulation. */
export function historyDateBounds(range: HistoryDateRange, now: number): [number, number] | null {
  if (range === 'all') return null
  const start = new Date(now)
  if (range === 'last7Days') start.setDate(start.getDate() - 6)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(24, 0, 0, 0)
  return [start.getTime(), end.getTime()]
}
