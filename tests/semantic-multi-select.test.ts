import { describe, expect, it } from 'vitest'
import { normalizeSelectValues, multiSelectScript } from '../src/main/browser/semantic-multi-select.js'
import { browserActionPayloadFingerprint } from '../src/main/mcp/browser-action-authority.js'

describe('bounded semantic option sets', () => {
  it('normalizes order without changing exact empty or Unicode values', () => {
    expect(normalizeSelectValues(['漢', '', 'a'])).toEqual(['', 'a', '漢'])
    expect(normalizeSelectValues([])).toEqual([])
  })
  it.each([null, 'a', [3], ['a', 'a'], Array(51).fill('x'), ['x'.repeat(1025)], Array.from({length:9},(_,i)=>`${i}${'x'.repeat(1023)}`)])('rejects invalid or over-limit input %j', values => {
    expect(()=>normalizeSelectValues(values)).toThrow()
  })
  it('binds the normalized complete set into action identity', () => {
    const hash=(values:string[])=>browserActionPayloadFingerprint({selector:'#choices',values:normalizeSelectValues(values)})
    expect(hash(['a','b'])).toBe(hash(['b','a']))
    expect(hash(['a','b'])).not.toBe(hash(['a']))
    expect(hash([])).not.toBe(hash(['']))
  })
  it('encodes payload as data rather than executable source', () => {
    const script=multiSelectScript({selector:'[data-value="x"]'}, ['";throw new Error(); //'])
    expect(()=>new Function(`return ${script}`)).not.toThrow()
  })
})
