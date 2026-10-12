import { describe, expect, it } from 'vitest'
import { normalizeTabLabel, restoreTabLabel } from '../src/shared/tab-label.js'

describe('tab labels', () => {
  it('normalizes task labels without changing ordinary text or counting surrogate pairs twice', () => {
    expect(normalizeTabLabel('  Cafe\u0301  ')).toBe('Café')
    expect(normalizeTabLabel('😀'.repeat(100))).toBe('😀'.repeat(100))
    expect(normalizeTabLabel('<Admin & customer>')).toBe('<Admin & customer>')
    expect(normalizeTabLabel('   ')).toBeUndefined()
  })
  it.each(['x'.repeat(101), ' '.repeat(1025), 'line\nfeed', 'tab\t', '\u0000', '\u007f', '\u202e', '\u2067', '\ud800', null, 42, {}])('rejects malformed and oversized input %#', value => {
    expect(() => normalizeTabLabel(value)).toThrow(TypeError)
    expect(restoreTabLabel(value)).toBeUndefined()
  })
  it('ignores missing persisted metadata', () => expect(restoreTabLabel(undefined)).toBeUndefined())
})
