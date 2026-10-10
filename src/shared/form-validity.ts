import type { BrowserFormValidity } from './types.js'

export const FORM_VALIDITY_FLAGS = [
  'valueMissing', 'typeMismatch', 'patternMismatch', 'tooLong', 'tooShort',
  'rangeUnderflow', 'rangeOverflow', 'stepMismatch', 'badInput', 'customError', 'valid'
] as const

export function normalizeFormValidity(raw: unknown): BrowserFormValidity {
  const unavailable: BrowserFormValidity = { status: 'unavailable', reason: 'native-unavailable' }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return unavailable
  const report = raw as Record<string, unknown>
  if (report.status === 'unavailable' && Object.keys(report).length === 2
    && (report.reason === 'unsupported-target' || report.reason === 'native-unavailable')) {
    return { status: 'unavailable', reason: report.reason }
  }
  if (report.status !== 'observed' || typeof report.willValidate !== 'boolean'
    || Object.keys(report).length !== 3 || !report.validity || typeof report.validity !== 'object'
    || Array.isArray(report.validity)) return unavailable
  const flags = report.validity as Record<string, unknown>
  if (Object.keys(flags).length !== FORM_VALIDITY_FLAGS.length
    || FORM_VALIDITY_FLAGS.some(key => typeof flags[key] !== 'boolean')) return unavailable
  return {
    status: 'observed', willValidate: report.willValidate,
    validity: Object.fromEntries(FORM_VALIDITY_FLAGS.map(key => [key, flags[key]])) as Extract<BrowserFormValidity, { status: 'observed' }>['validity']
  }
}
