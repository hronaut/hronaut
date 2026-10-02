import { describe, expect, it } from 'vitest'
import { normalizeRuntimeConsolePresentation } from '../src/shared/console-exceptions.js'

const stackTrace = { callFrames: [{ functionName: 'probe', url: 'https://example.test/app.js', lineNumber: 2, columnNumber: 1 }] }
const string = (value: string) => ({ type: 'string', value })

describe('plain-text console presentation', () => {
  it.each([
    [['Hello %s', 'world'], 'Hello world'],
    [['%cBanner%c ready', 'color:red', ''], 'Banner ready'],
    [['missing %s %d', 'one'], 'missing one %d'],
    [['extra %s', 'one', 'two'], 'extra one two'],
    [['100%% %s', 'done'], '100% done'],
    [['unknown %q %s', 'one'], 'unknown %q one'],
    [['token=%s%s', 'private-', 'secret'], 'token=[REDACTED]']
  ])('renders %j without changing matching text', (values, expected) => {
    const result = normalizeRuntimeConsolePresentation({ type: 'log', args: values.map(string), stackTrace })
    expect(result?.presentation).toBe(expected)
    expect(result?.match.stack).toBeUndefined()
    if (!values[0]?.includes('token=')) expect(result?.match.message).toBe(values.join(' ').trim())
  })

  it('formats numeric primitives and preserves warning stacks', () => {
    const result = normalizeRuntimeConsolePresentation({ type: 'warning', args: [string('%d %i %f'), { type: 'number', value: 3.8 }, string('12px'), string('1.25px')], stackTrace })
    expect(result?.presentation).toBe('3 12 1.25')
    expect(result?.match.stack).toHaveLength(1)
  })

  it('does not expand objects or reinterpret a literal template without arguments', () => {
    expect(normalizeRuntimeConsolePresentation({ type: 'log', args: [string('%s')], stackTrace })).toBeUndefined()
    expect(normalizeRuntimeConsolePresentation({ type: 'log', args: [string('%s %o'), string('safe'), { type: 'object', description: 'Object' }], stackTrace })).toBeUndefined()
    expect(normalizeRuntimeConsolePresentation({ type: 'log', args: [string('%o %s'), string('one'), string('two')], stackTrace })).toBeUndefined()
  })

  it('bounds presentation and sanitizes assembled URL credentials', () => {
    const result = normalizeRuntimeConsolePresentation({ type: 'error', args: [string('https://%s:%s@example.test/ %s'), string('user'), string('secret'), string('x'.repeat(5000))], stackTrace })
    expect(result?.presentation).not.toContain('secret')
    expect(result?.presentation.length).toBeLessThanOrEqual(4000)
  })
})
