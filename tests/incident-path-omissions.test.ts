import { expect, it } from 'vitest'
import { omitIncidentPaths } from '../src/main/incident-path-omissions.js'
import { incidentReviewSchema, type IncidentKind } from '../src/shared/incident-package.js'

const rule = (path: Array<string | number>, artifact: IncidentKind = 'diagnostics') => ({ artifact, path })
const input = (omitPaths: unknown) => ({ draftId: '01912345-6789-7abc-8def-0123456789ab', include: ['diagnostics'], replacements: [], omitPaths })
it('removes one literal property while preserving siblings, artifacts and array positions', () => {
  const value = { console: [{ message: 'remove', keep: 1 }, { message: 'keep' }], message: 'root' }
  const network = { console: [{ message: 'other artifact' }] }
  const data = new Map<IncidentKind, unknown>([['diagnostics', value], ['network', network]])
  omitIncidentPaths(data, [rule(['console', 0, 'message'])])
  expect(value).toEqual({ console: [{ keep: 1 }, { message: 'keep' }], message: 'root' })
  expect(network.console[0]!.message).toBe('other artifact')
})
it('treats punctuation, empty keys and prototype-like own properties literally', () => {
  const value = JSON.parse('{"a.b":{"/":{"":1}},"__proto__":{"private":2},"constructor":3,"0":4}')
  omitIncidentPaths(new Map([['diagnostics', value]]), [rule(['a.b','/','']), rule(['__proto__']), rule(['constructor']), rule(['0'])])
  expect(value).toEqual({ 'a.b': { '/': {} } })
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
})
it.each([
  [rule(['a']), rule(['absent-private-token'])],
  [rule(['a']), rule(['a'])],
  [rule(['a']), rule(['a','b'])],
  [rule(['a','b']), rule(['a'])],
  [rule(['rows',0])], [rule(['rows','0','field'])],
  [rule(['rows','length'])], [rule(['toString'])],
  [rule(['a',0])], [rule(['a'], 'network')]
].map(rules => ({ rules })))('rejects unresolved or overlapping rules before changing any data: %#', ({ rules }) => {
  const source = { a: { b: 1 }, rows: [{ field: 2 }] }
  const before = structuredClone(source)
  expect(() => omitIncidentPaths(new Map([['diagnostics', source]]), rules)).toThrow(/^Path omission \d+ /)
  expect(source).toEqual(before)
  try { omitIncidentPaths(new Map([['diagnostics', source]]), rules) } catch (error) {
    expect(String(error)).not.toContain('absent-private-token')
  }
})
it.each([
  [], ['x'.repeat(257)], Array.from({ length: 17 }, () => 'a'),
  [false], [-1], [1.1], [Number.MAX_SAFE_INTEGER + 1],
  Array.from({ length: 16 }, () => 'я'.repeat(256))
].map(path => ({ path })))('bounds literal paths: %#', ({ path }) => {
  expect(incidentReviewSchema.safeParse(input([rule(path as Array<string | number>)] )).success).toBe(false)
})
it('accepts typed literal segments and bounds rule count', () => {
  expect(incidentReviewSchema.safeParse(input([rule(['console',0,''])])).success).toBe(true)
  expect(incidentReviewSchema.safeParse(input(Array.from({ length: 11 }, (_, i) => rule([String(i)])))).success).toBe(false)
})
