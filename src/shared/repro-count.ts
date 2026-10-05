import { redactDiagnosticText } from './debug-report.js'

export const MAX_REPRO_COUNT = 500
export const MAX_REPRO_COUNT_NODES = 2000
// Only structural light-DOM selectors may be retained, including for zero matches.
export const REPRO_COUNT_SELECTOR_PATTERN = /^[a-z][a-z0-9-]*(?::nth-of-type\([1-9][0-9]{0,5}\))?(?: > [a-z][a-z0-9-]*(?::nth-of-type\([1-9][0-9]{0,5}\))?)*$/

export function validReproCountSelector(selector: unknown): selector is string {
  return typeof selector === 'string' && selector.length <= 500 && selector.trim() === selector
    && REPRO_COUNT_SELECTOR_PATTERN.test(selector) && redactDiagnosticText(selector) === selector
}

export function validReproCount(count: unknown): count is number {
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= MAX_REPRO_COUNT
}
