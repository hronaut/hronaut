import { pageScript } from '../../shared/page-script.js'
import { ISOLATED_WORLDS } from './isolated-worlds.js'
import { multiSelectInPage } from './semantic-multi-select.page.js'

export const MULTI_SELECT_WORLD_ID = ISOLATED_WORLDS.multiSelect
export const MULTI_SELECT_LIMITS = { values: 50, valueLength: 1024, totalLength: 8192, options: 1000 } as const

export function normalizeSelectValues(values: unknown): string[] {
  if (!Array.isArray(values) || values.length > MULTI_SELECT_LIMITS.values
    || values.some(value => typeof value !== 'string' || value.length > MULTI_SELECT_LIMITS.valueLength)
    || values.reduce((total, value) => total + value.length, 0) > MULTI_SELECT_LIMITS.totalLength) {
    throw new Error('Provide at most 50 exact option values, each at most 1024 UTF-16 units and 8192 units in total')
  }
  if (new Set(values).size !== values.length) throw new Error('Duplicate requested option values are not allowed')
  return [...values].sort()
}

export function multiSelectScript(target: { ref?: string; selector?: string }, values: string[]): string {
  return pageScript(multiSelectInPage, { ref: target.ref, selector: target.selector }, values, MULTI_SELECT_LIMITS.options, MULTI_SELECT_LIMITS.valueLength)
}
