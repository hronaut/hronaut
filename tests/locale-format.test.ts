import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatLocaleSource, formattedLocaleFile, localeFiles } from '../scripts/format-locales.ts'

describe('locale files', () => {
  it('hold one key per line in en-US order, as npm run format:locales writes them', () => {
    const files = localeFiles()
    expect(files.length).toBeGreaterThan(17)
    const unformatted = files
      .filter((path) => formattedLocaleFile(path) !== readFileSync(path, 'utf8'))
      .map((path) => relative(process.cwd(), path))
    expect(unformatted, 'run npm run format:locales').toEqual([])
  })
})

describe('formatLocaleSource', () => {
  it('puts each key on its own line and keeps values, spreads and references', () => {
    const source = [
      "import { more } from './more.js'",
      '',
      "export const enUS = { title: \"Title\", 'plain-key': 'x', nested: { a: 'A', \"b\": \"B\" }, empty: {}, ...more['en-US'], ref: more.x }",
      ''
    ].join('\n')
    expect(formatLocaleSource(source)).toBe([
      "import { more } from './more.js'",
      '',
      'export const enUS = {',
      "  title: 'Title',",
      "  'plain-key': 'x',",
      '  nested: {',
      "    a: 'A',",
      "    b: 'B'",
      '  },',
      '  empty: {},',
      "  ...more['en-US'],",
      '  ref: more.x',
      '}',
      ''
    ].join('\n'))
  })

  it('chooses the quotes that need fewer escapes and keeps every other escape as written', () => {
    const source = String.raw`export const m = { a: "it's", b: 'say "hi"', c: "both ' \" '", d: "line\nnext — \\", e: 'it\'s' }`
    const formatted = formatLocaleSource(source)
    expect(formatted).toBe([
      'export const m = {',
      `  a: "it's",`,
      `  b: 'say "hi"',`,
      String.raw`  c: "both ' \" '",`,
      String.raw`  d: 'line\nnext — \\',`,
      `  e: "it's"`,
      '}'
    ].join('\n'))
    const values = (text: string): unknown => new Function(`${text.replace('export const m =', 'return')}`)()
    expect(values(formatted)).toEqual(values(source))
  })

  it('orders a language like the en-US file, keeping keys en-US lacks at the end', () => {
    const english = "export const enUS = { a: 'A', b: { x: 'X', y: 'Y' }, c: 'C' }"
    const german = "export const deDE: MessageSchema = { extra: 'E', c: 'C', b: { y: 'Y', x: 'X' }, a: 'A' }"
    expect(formatLocaleSource(german, 'de-DE.ts', english)).toBe([
      'export const deDE: MessageSchema = {',
      "  a: 'A',",
      '  b: {',
      "    x: 'X',",
      "    y: 'Y'",
      '  },',
      "  c: 'C',",
      "  extra: 'E'",
      '}'
    ].join('\n'))
  })

  it('moves keys only between spreads, so what overrides what stays the same', () => {
    const english = "export const enUS = { a: 'A', ...base, b: 'B', c: 'C' }"
    const german = "export const deDE = { a: 'A', ...base, c: 'C', b: 'B' }"
    expect(formatLocaleSource(german, 'de-DE.ts', english)).toBe([
      'export const deDE = {',
      "  a: 'A',",
      '  ...base,',
      "  b: 'B',",
      "  c: 'C'",
      '}'
    ].join('\n'))
  })

  it("orders every language in one module like its 'en-US' entry", () => {
    const source = "export const words = { 'en-US': { a: 'A', b: 'B' }, 'de-DE': { b: 'B', a: 'A' }, other: { b: 'B', a: 'A' } }"
    expect(formatLocaleSource(source)).toBe([
      'export const words = {',
      "  'en-US': {",
      "    a: 'A',",
      "    b: 'B'",
      '  },',
      "  'de-DE': {",
      "    a: 'A',",
      "    b: 'B'",
      '  },',
      '  other: {',
      "    b: 'B',",
      "    a: 'A'",
      '  }',
      '}'
    ].join('\n'))
  })

  it('indents an object by the line it starts on and leaves other values as written', () => {
    const source = "const words = {\n  list: [{ a: 'A' }]\n}"
    expect(formatLocaleSource(source)).toBe("const words = {\n  list: [{ a: 'A' }]\n}")
    const nested = "function words() {\n  return { a: 'A', b: 'B' }\n}"
    expect(formatLocaleSource(nested)).toBe("function words() {\n  return {\n    a: 'A',\n    b: 'B'\n  }\n}")
  })

  it('refuses a comment inside messages instead of dropping it', () => {
    expect(() => formatLocaleSource("export const m = {\n  // note\n  a: 'A'\n}", 'm.ts')).toThrow(/m\.ts:1: a comment/)
    expect(formatLocaleSource("// note\nexport const m = { a: 'https://example.com' }"))
      .toBe("// note\nexport const m = {\n  a: 'https://example.com'\n}")
  })
})
