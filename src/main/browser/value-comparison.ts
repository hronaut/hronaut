import { pageScript } from '../../shared/page-script.js'
import { MAX_COMPARED_TEXT_VALUE_LENGTH } from '../../shared/value-comparison.js'
import { valueComparisonSettlementInPage } from './value-comparison.page.js'

// Both entry points accept only the internal randomUUID handle, never page input.
export function valueComparisonToken(token: string): string {
  if (typeof token !== 'string' || token.length !== 36
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) {
    throw new TypeError('Invalid value comparison token')
  }
  return token
}

export function valueComparisonExpected(expected: string): string {
  if (typeof expected !== 'string' || expected.length > MAX_COMPARED_TEXT_VALUE_LENGTH) {
    throw new TypeError('Invalid expected value')
  }
  return expected
}

export function valueComparisonSettlementScript(token: string, cancel = false): string {
  return pageScript(valueComparisonSettlementInPage, valueComparisonToken(token), cancel)
}
