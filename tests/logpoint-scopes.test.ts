import { describe, expect, it } from 'vitest'
import { decodeScopes, originalBindings, rewriteOriginalNames, withOriginalNames } from '../src/main/browser/logpoints/logpoint-scopes.js'

const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function unsigned(value: number): string {
  let text = ''
  do {
    let digit = value & 31
    value >>>= 5
    if (value) digit |= 32
    text += DIGITS[digit]
  } while (value)
  return text
}
const signed = (value: number): number => (value < 0 ? (-value << 1) | 1 : value << 1)
const item = (...values: number[]): string => values.map(unsigned).join('')

// The proposal's example: z(message) with y inside, inlined at its call on line 5.
// var _x = 1;
// function _z(_m) {
//   let _y = 2;
//   console.log(_m + _y);
// }
// console.log("Hello World2");
const NAMES = ['x', 'z', 'message', 'y', '_x', '_z', '_m', '_y', '"Hello World"', '2']
function example(extra: string[] = []): string {
  return [
    item(1, 0, 0, 0), item(3, signed(0), signed(1)),
    item(1, 5, 1, 10, signed(1)), item(3, signed(1), signed(1)),
    item(2, 3, 1), item(2, 1, 17),
    item(4, 2, 0, signed(0)), item(6, 5, 6),
    item(4, 7, 1, 16, signed(1)), item(6, 7, 8), ...extra,
    item(5, 3, 1),
    item(4, 3, 1, 0, signed(0)), item(6, 9, 10), item(8, 0, 5, 0),
    item(5, 28), item(5, 0)
  ].join(',')
}

describe('logpoint source map scopes', () => {
  it('decodes which original variables each generated range reads, and through what', () => {
    const scopes = decodeScopes(example(), NAMES)!
    expect(scopes.originalVariables).toEqual([['x', 'z'], ['message', 'y']])
    expect(Object.fromEntries(originalBindings(scopes, 3, 2))).toEqual({ x: '_x', z: '_z', message: '_m', y: '_y' })
    // In the inlined call, the function's variables are constants.
    expect(Object.fromEntries(originalBindings(scopes, 5, 5))).toEqual({ x: '_x', z: '_z', message: '"Hello World"', y: '2' })
    // Past the end of every range, nothing is known.
    expect(originalBindings(scopes, 9, 0).size).toBe(0)
  })

  it('follows a variable that has no value in part of its range', () => {
    // y has no value from line 2, column 2 on.
    const scopes = decodeScopes(example([item(7, 1, 0, 1, 2)]), NAMES)!
    expect(originalBindings(scopes, 1, 20).get('y')).toBe('_y')
    expect(originalBindings(scopes, 3, 2).get('y')).toBeNull()
    expect(() => rewriteOriginalNames('message + y', originalBindings(scopes, 3, 2), 'Logpoint 1')).toThrow(/y has no value at that location/)
  })

  it('refuses malformed or unbalanced scopes rather than guessing', () => {
    expect(decodeScopes(undefined, NAMES)).toBeUndefined()
    expect(decodeScopes('!!', NAMES)).toBeUndefined()
    expect(decodeScopes(item(1, 0, 0, 0), NAMES)).toBeUndefined()
    expect(decodeScopes([item(1, 0, 0, 0), item(3, signed(99)), item(2, 0, 1)].join(','), NAMES)).toBeUndefined()
    // An unknown tag is skipped.
    expect(decodeScopes([item(1, 0, 0, 0), item(20, 3, 4), item(2, 0, 1)].join(','), NAMES)?.originalVariables).toEqual([[]])
  })

  it('replaces only the original variables an expression reads', () => {
    const bindings = originalBindings(decodeScopes(example(), NAMES)!, 3, 2)
    const rewrite = (expression: string) => rewriteOriginalNames(expression, bindings, 'Logpoint 1').expression
    expect(rewrite('message + y')).toBe('_m + _y')
    expect(rewrite('cart.message ?? obj?.y')).toBe('cart.message ?? obj?.y')
    expect(rewrite('{ message: y, y }')).toBe('{ message: _y, y: _y }')
    expect(rewrite('[\'message\', "y", `${message} and ${`y=${y}`}`]')).toBe('[\'message\', "y", `${_m} and ${`y=${_y}`}`]')
    expect(rewrite('/y/.test(message) && x / y / 2 // y')).toBe('/y/.test(_m) && _x / _y / 2 // y')
    expect(rewrite('[1, 2].map(y => y + message)')).toBe('[1, 2].map(_y => _y + _m)')
    expect(rewrite('(() => { y })()')).toBe('(() => { _y })()')
    expect(rewriteOriginalNames('message + y', bindings, 'Logpoint 1').originalNames).toEqual([
      { name: 'message', generated: '_m' }, { name: 'y', generated: '_y' }
    ])
  })

  it('wraps an expression the generated code reads a variable through', () => {
    const bindings = originalBindings(decodeScopes(example(), NAMES)!, 5, 5)
    expect(rewriteOriginalNames('message.length + y', bindings, 'Logpoint 1').expression).toBe('("Hello World").length + (2)')
  })

  it('changes nothing without scopes, or when no name needs replacing', () => {
    expect(withOriginalNames('Logpoint 1', 'message', undefined, 3, 2)).toEqual({})
    expect(withOriginalNames('Logpoint 1', 'message', { scopes: 'not scopes', names: NAMES }, 3, 2)).toEqual({})
    expect(withOriginalNames('Logpoint 1', '_m + 1', { scopes: example(), names: NAMES }, 3, 2)).toEqual({})
    expect(withOriginalNames('Logpoint 1', 'message', { scopes: example(), names: NAMES }, 3, 2))
      .toEqual({ evaluated: '_m', originalNames: [{ name: 'message', generated: '_m' }] })
  })
})
