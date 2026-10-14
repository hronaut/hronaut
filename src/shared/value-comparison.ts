/** UTF-16 code units, applied to both the expected and the observed value. */
export const MAX_COMPARED_TEXT_VALUE_LENGTH = 4_096

export type BrowserValueComparison =
  | { status: 'match' | 'mismatch' }
  | { status: 'unavailable'; reason: 'unsupported-target' | 'native-unavailable' | 'oversized' }

export function normalizeValueComparison(raw: unknown): BrowserValueComparison {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { status: 'unavailable', reason: 'native-unavailable' }
  const report = raw as Record<string, unknown>
  const keys = Object.keys(report).length
  if ((report.status === 'match' || report.status === 'mismatch') && keys === 1) return { status: report.status }
  if (report.status === 'unavailable' && keys === 2
    && (report.reason === 'unsupported-target' || report.reason === 'native-unavailable' || report.reason === 'oversized')) {
    return { status: 'unavailable', reason: report.reason }
  }
  return { status: 'unavailable', reason: 'native-unavailable' }
}
