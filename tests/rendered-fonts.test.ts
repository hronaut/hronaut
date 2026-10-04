import { describe, expect, it } from 'vitest'
import { normalizeRenderedFonts, unavailableRenderedFonts } from '../src/shared/rendered-fonts.js'

const font = { familyName: 'Fixture Family', postScriptName: 'FixtureFamily', glyphCount: 3, isCustomFont: true }
describe('bounded rendered-font output', () => {
  it('preserves only observed metadata and distinguishes empty from unavailable', () => {
    expect(normalizeRenderedFonts({ fonts: [{ ...font, text: 'private-canary', path: '/private/font.ttf', nodeId: 17 }] })).toMatchObject({ status: 'observed', scope: 'selected-leaf-element', fonts: [font], truncated: false })
    expect(normalizeRenderedFonts({ fonts: [] })).toMatchObject({ status: 'empty', fonts: [], truncated: false })
    expect(unavailableRenderedFonts('unsupported-target')).toMatchObject({ status: 'unavailable', reason: 'unsupported-target', fonts: [] })
  })
  it('caps records and omits long, path, control and credential-bearing names', () => {
    const report = normalizeRenderedFonts({ fonts: Array.from({ length: 21 }, () => ({ ...font, familyName: 'x'.repeat(129), postScriptName: '/private/font.ttf' })) })
    expect(report.fonts).toHaveLength(20)
    expect(report.fonts[0]).toMatchObject({ familyName: null, postScriptName: null })
    expect(report.truncated).toBe(true)
    for (const value of ['bad\nname', 'C:\\font.ttf', 'https://secret.test/font', 'hidden\u202ename']) {
      expect(normalizeRenderedFonts({ fonts: [{ ...font, familyName: value }] }).fonts[0]!.familyName).toBeNull()
    }
    expect(JSON.stringify(report).length).toBeLessThan(10_000)
  })
  it('does not coerce invalid counts or custom-font flags', () => {
    for (const glyphCount of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '3']) {
      expect(normalizeRenderedFonts({ fonts: [{ ...font, glyphCount }] })).toMatchObject({ fonts: [], truncated: true })
    }
    expect(normalizeRenderedFonts({ fonts: [{ ...font, isCustomFont: 'false' }, null] })).toMatchObject({ fonts: [], truncated: true })
    expect(() => normalizeRenderedFonts({})).toThrow('Invalid rendered-font')
  })
})
