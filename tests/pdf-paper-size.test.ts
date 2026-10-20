import { describe, expect, it } from 'vitest'
import { regionalPdfPageSize } from '../src/main/browser/pdf-export/pdf-paper-size.js'

describe('the paper of a PDF saved from Hronaut', () => {
  it.each([
    ['DE', 'de-DE', 'A4'],
    ['GB', 'en-GB', 'A4'],
    ['IN', 'en-IN', 'A4'],
    ['JP', 'ja-JP', 'A4'],
    ['UA', 'uk-UA', 'A4'],
    ['US', 'en-US', 'Letter'],
    ['CA', 'fr-CA', 'Letter'],
    ['MX', 'es-MX', 'Letter'],
    ['ph', 'en-PH', 'Letter']
  ])('uses the standard paper of region %s', (countryCode, systemLocale, paper) => {
    // The PDF button saved Letter everywhere, so a page saved in Germany printed shrunk or cut on A4.
    expect(regionalPdfPageSize(countryCode, systemLocale)).toBe(paper)
  })

  it('follows the region the system is set to over its language', () => {
    expect(regionalPdfPageSize('DE', 'en-US')).toBe('A4')
    expect(regionalPdfPageSize('US', 'de-DE')).toBe('Letter')
  })

  it('falls back to the language when the system names no region', () => {
    expect(regionalPdfPageSize('', 'de')).toBe('A4')
    expect(regionalPdfPageSize('', 'pl-PL')).toBe('A4')
    expect(regionalPdfPageSize('', 'en-US')).toBe('Letter')
    expect(regionalPdfPageSize('', 'en')).toBe('Letter')
  })

  it('keeps Letter, as before, when nothing names a region', () => {
    expect(regionalPdfPageSize('', '')).toBe('Letter')
    expect(regionalPdfPageSize('001', 'not a locale!')).toBe('Letter')
  })
})
