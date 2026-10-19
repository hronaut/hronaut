import { describe, expect, it } from 'vitest'
import { evaluationRecord, failedEvaluationRecord, projectValue, wrappedExpression } from '../src/main/browser/logpoints/logpoint-values.js'

const MARK = '0123456789abcdef0123456789abcdef'
const AT = '2026-10-19T10:00:00.000Z'

/** Evaluates the wrapped expression the way the paused frame would, with the given variables in scope. */
function evaluate(expression: string, scope: Record<string, unknown> = {}): unknown {
  return new Function(...Object.keys(scope), `return ${wrappedExpression(expression, MARK)}`)(...Object.values(scope))
}

describe('the expression at a hit', () => {
  it('cuts a long string inside the page and marks it with its full length', () => {
    expect(evaluate('"x".repeat(5000)')).toBe(`${MARK}5000:${'x'.repeat(200)}`)
    expect(evaluate('label', { label: 'short' })).toBe('short')
    expect(evaluate('[a, b]', { a: 1, b: 2 })).toEqual([1, 2])
  })

  it('keeps the closing parentheses when the expression ends in a line comment', () => {
    expect(evaluate('total // the running sum', { total: 20 })).toBe(20)
  })

  it('reads a cut string back with its length, and cuts any other long string', () => {
    expect(projectValue({ type: 'string', value: `${MARK}5000:${'x'.repeat(200)}` }, MARK)).toEqual({ type: 'string', value: 'x'.repeat(200), chars: 5000 })
    expect(projectValue({ type: 'string', value: 'y'.repeat(300) }, MARK)).toEqual({ type: 'string', value: 'y'.repeat(200), chars: 300 })
    // A page string that happens to start like a mark without its secret is kept as text.
    expect(projectValue({ type: 'string', value: '5000:abc' }, MARK)).toEqual({ type: 'string', value: '5000:abc' })
  })
})

describe('recorded values', () => {
  it('keeps primitives and never a function\'s source', () => {
    expect(projectValue({ type: 'number', value: 20 }, MARK)).toEqual({ type: 'number', value: 20 })
    expect(projectValue({ type: 'number', unserializableValue: 'NaN', description: 'NaN' }, MARK)).toEqual({ type: 'number', value: 'NaN' })
    expect(projectValue({ type: 'bigint', unserializableValue: '12n' }, MARK)).toEqual({ type: 'bigint', value: '12n' })
    expect(projectValue({ type: 'boolean', value: true }, MARK)).toEqual({ type: 'boolean', value: true })
    expect(projectValue({ type: 'undefined' }, MARK)).toEqual({ type: 'undefined' })
    expect(projectValue({ type: 'symbol', description: 'Symbol(id)' }, MARK)).toEqual({ type: 'symbol', value: 'Symbol(id)' })
    expect(projectValue({ type: 'function', description: 'function secret() { return "SOURCE" }' }, MARK)).toEqual({ type: 'function' })
    expect(projectValue({ type: 'object', subtype: 'null', value: null }, MARK)).toEqual({ type: 'object', subtype: 'null' })
  })

  it('keeps an object\'s bounded preview and an error\'s first line, without function sources', () => {
    expect(projectValue({
      type: 'object',
      subtype: 'array',
      description: 'Array(7)',
      preview: {
        overflow: false,
        properties: [
          { name: '0', type: 'number', value: '170' },
          { name: '1', type: 'function', value: 'function leak() { return "SOURCE" }' },
          { name: '2', type: 'string', value: 'z'.repeat(150) },
          { name: '3', type: 'object', subtype: 'date', value: 'Mon Oct 19 2026' },
          { name: 'n'.repeat(80), type: 'number', value: '1' },
          { name: '5', type: 'number', value: '2' }
        ]
      }
    }, MARK)).toEqual({
      type: 'object',
      subtype: 'array',
      description: 'Array(7)',
      properties: [
        { name: '0', type: 'number', value: '170' },
        { name: '1', type: 'function' },
        { name: '2', type: 'string', value: `${'z'.repeat(99)}…` },
        { name: '3', type: 'object', subtype: 'date', value: 'Mon Oct 19 2026' },
        { name: `${'n'.repeat(59)}…`, type: 'number', value: '1' }
      ],
      overflow: true
    })
    expect(projectValue({ type: 'object', subtype: 'error', description: 'TypeError: bad cart\n    at total (https://shop.test/bundle.js:17:6)' }, MARK))
      .toEqual({ type: 'object', subtype: 'error', description: 'TypeError: bad cart' })
  })

  it('records why a hit has no value', () => {
    expect(evaluationRecord({ result: { type: 'number', value: 20 } }, MARK, AT)).toEqual({ at: AT, value: { type: 'number', value: 20 } })
    expect(evaluationRecord({ exceptionDetails: { text: 'Uncaught', exception: { description: 'EvalError: Possible side-effect in debug-evaluate' } } }, MARK, AT))
      .toEqual({ at: AT, error: { kind: 'side-effect' } })
    expect(evaluationRecord({ exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: Execution was terminated' } } }, MARK, AT))
      .toEqual({ at: AT, error: { kind: 'timeout' } })
    expect(evaluationRecord({ exceptionDetails: { text: 'Uncaught', exception: { description: `ReferenceError: item is not defined\n    at eval\n${'x'.repeat(400)}` } } }, MARK, AT))
      .toEqual({ at: AT, error: { kind: 'exception', message: 'ReferenceError: item is not defined' } })
    // A thrown function is described by its source, so only the kind is kept.
    expect(evaluationRecord({ exceptionDetails: { text: 'Uncaught', exception: { type: 'function', description: 'function leak() { return "SOURCE" }' } } }, MARK, AT))
      .toEqual({ at: AT, error: { kind: 'exception' } })
    expect(failedEvaluationRecord(new Error('Execution was terminated'), AT)).toEqual({ at: AT, error: { kind: 'timeout' } })
    expect(failedEvaluationRecord(new Error('Could not find call frame'), AT)).toEqual({ at: AT, error: { kind: 'unavailable' } })
  })
})
