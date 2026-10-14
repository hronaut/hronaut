import { describe, expect, it } from 'vitest'
import { elementInspectionScript } from '../src/main/browser/page-scripts.js'
import { valueComparisonSettlementScript, valueComparisonSource } from '../src/main/browser/value-comparison.js'
import { normalizeValueComparison } from '../src/shared/value-comparison.js'

const token = '0b6f1c1e-4a1b-4c3d-8e9f-0123456789ab'

describe('expected value comparison', () => {
  it('accepts only fixed outcomes from the page', () => {
    expect(normalizeValueComparison({ status: 'match' })).toEqual({ status: 'match' })
    expect(normalizeValueComparison({ status: 'mismatch' })).toEqual({ status: 'mismatch' })
    expect(normalizeValueComparison({ status: 'unavailable', reason: 'oversized' })).toEqual({ status: 'unavailable', reason: 'oversized' })
    for (const raw of [null, 'match', [], { status: 'match', value: 'PRIVATE' }, { status: 'mismatch', length: 3 },
      { status: 'unavailable', reason: 'PRIVATE' }, { status: 'unavailable' }]) {
      expect(normalizeValueComparison(raw)).toEqual({ status: 'unavailable', reason: 'native-unavailable' })
    }
  })

  it('embeds the expected text only in the comparison reducer', () => {
    const expected = 'PRIVATE </script>   "quoted"'
    const script = elementInspectionScript({ selector: '#notes' }, token, expected)
    expect(script.split(JSON.stringify('PRIVATE').slice(1, -1)).length - 1).toBe(1)
    expect(script).not.toContain('</script>')
    expect(script).not.toContain(' ')
    expect(script).not.toMatch(/"expectedValue"/)
    expect(elementInspectionScript({ selector: '#notes' }, token)).not.toContain('valueComparison')
  })

  it('rejects malformed tokens and oversized expected values before building a script', () => {
    expect(() => valueComparisonSource('not-a-token', '')).toThrow(TypeError)
    expect(() => valueComparisonSettlementScript("'); alert(1); ('")).toThrow(TypeError)
    expect(() => valueComparisonSource(token, 'x'.repeat(4097))).toThrow(TypeError)
    expect(valueComparisonSource(token, 'x'.repeat(4096))).toContain('expected=')
  })
})
