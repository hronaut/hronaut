import { describe, expect, it } from 'vitest'
import {
  CSS_PROVENANCE_LIMITS, cssSourceHeader, normalizeCssProperties, normalizeCssProvenance
} from '../src/shared/css-provenance.js'

const range = { startLine: 2, startColumn: 4 }
function rule(value = 'none !important', extras = {}) {
  return { matchingSelectors: [0], rule: { styleSheetId: 'sheet', origin: 'regular', selectorList: { text: '.toast, .private-unmatched', selectors: [{ text: '.toast' }, { text: '.private-unmatched' }] },
    media: [{ text: '(min-width: 1px)' }], layers: [{ text: 'base' }],
    style: { styleSheetId: 'sheet', range, cssProperties: [
      { name: 'display', value, important: true, range, ...extras },
      { name: 'display', value, important: true },
      { name: 'content', value: 'private-content-canary' },
      { name: '--private-variable', value: 'private-variable-canary' }
    ] } } }
}
const headers = new Map([['sheet', cssSourceHeader({ sourceURL: 'https://user:pass@example.test/style.css?token=private#fragment', startLine: 10, startColumn: 3 })]])

describe('explicit bounded CSS provenance', () => {
  it('leaves computed-only inspection unchanged unless properties are requested', () => {
    expect(normalizeCssProperties(undefined)).toBeUndefined()
    expect(normalizeCssProperties(['display', 'display', 'opacity'])).toEqual(['display', 'opacity'])
  })
  it.each([[], ['content'], ['--secret'], ['background-image'], ['font-family'], Array(9).fill('display'), 'display', null])('rejects unsupported property requests %j', value => {
    expect(() => normalizeCssProperties(value)).toThrow('cssProperties')
  })
  it('reports competing declarations and source positions without inventing a winner', () => {
    const result = normalizeCssProvenance({ properties: ['display'], headers,
      matched: { matchedCSSRules: [rule(), rule('block')] },
      computed: { computedStyle: [{ name: 'display', value: 'none' }] } })
    expect(result.computed).toEqual([{ property: 'display', value: 'none' }])
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0]).toMatchObject({ value: 'none !important', important: true, inheritanceDepth: 0,
      conditions: [{ type: 'media', text: '(min-width: 1px)' }, { type: 'layers', text: 'base' }],
      source: { url: 'https://example.test/style.css', line: 13, column: 5, precision: 'declaration' } })
    expect(JSON.stringify(result)).not.toMatch(/private-content|private-variable|private-unmatched|token=|fragment|user:pass|"winner"|cssText|styleSheetId/)
  })
  it('keeps inline, inherited and disabled declarations distinct', () => {
    const result = normalizeCssProvenance({ properties: ['display'], headers, computed: {}, matched: {
      inlineStyle: { cssProperties: [{ name: 'display', value: 'block', disabled: true }] },
      inherited: [{ matchedCSSRules: [rule()] }]
    } })
    expect(result.candidates[0]).toMatchObject({ kind: 'inline', disabled: true, inheritanceDepth: 0 })
    expect(result.candidates[0]).not.toHaveProperty('source')
    expect(result.candidates[1]).toMatchObject({ kind: 'rule', inheritanceDepth: 1 })
  })
  it.each(['url(https://private.test/secret)', 'u\\72l(private)', 'var(--private)', 'attr(data-private)', 'env(private)', '"private"', 'data:private', 'a'.repeat(301)])('omits unsafe or dependent CSS values %s', value => {
    const result = normalizeCssProvenance({ properties: ['display'], headers, computed: {}, matched: { matchedCSSRules: [rule(value)] } })
    expect(result.candidates[0]).toMatchObject({ value: null, valueOmitted: true })
    expect(JSON.stringify(result.candidates)).not.toContain('private')
  })
  it('omits invalid authored values and comments without guessing a replacement', () => {
    const result = normalizeCssProvenance({ properties: ['display'], headers, computed: {}, matched: {
      matchedCSSRules: [rule('private-invalid', { parsedOk: false }), rule('block /* private-comment */')]
    } })
    expect(result.candidates.map(candidate => candidate.value)).toEqual([null, 'block'])
  })
  it('does not expose invalid declaration mirrors when protocol entries arrive in another order', () => {
    const match = rule('private-invalid-canary', { parsedOk: false })
    match.rule.style.cssProperties.reverse()
    const result = normalizeCssProvenance({ properties: ['display'], headers, computed: {}, matched: { matchedCSSRules: [match] } })
    expect(result.candidates.map(candidate => candidate.value)).toEqual([null])
    expect(JSON.stringify(result)).not.toContain('private-invalid-canary')
  })
  it('bounds candidates, ancestor depth, labels and serialized bytes', () => {
    const oversized = rule()
    oversized.rule.selectorList.selectors[0]!.text = '😀'.repeat(500)
    const result = normalizeCssProvenance({ properties: ['display'], headers, computed: {}, matched: {
      matchedCSSRules: Array(2_000).fill(oversized), inherited: Array(30).fill({ matchedCSSRules: [rule()] })
    } })
    expect(result.truncated).toBe(true)
    expect(result.candidates.length).toBeLessThanOrEqual(CSS_PROVENANCE_LIMITS.candidates)
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(CSS_PROVENANCE_LIMITS.outputBytes)
    expect(result.candidates.every(candidate => candidate.inheritanceDepth <= 10)).toBe(true)
  })
  it('distinguishes fallback rule coordinates and omits unknown/non-network origins', () => {
    const match = rule()
    delete (match.rule.style.cssProperties[0] as { range?: unknown }).range
    const result = normalizeCssProvenance({ properties: ['display'], headers, computed: {}, matched: { matchedCSSRules: [match] } })
    expect(result.candidates[0]?.source?.precision).toBe('rule')
    expect(cssSourceHeader({ sourceURL: 'data:text/css,private', startLine: -1 })).toEqual({ url: undefined, startLine: undefined, startColumn: undefined })
    expect(cssSourceHeader({ sourceURL: 'https://example.test/' + 'x'.repeat(9_000) }).url).toBeUndefined()
  })
})
