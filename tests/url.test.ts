import { describe, expect, it } from 'vitest'
import { normalizeAddress } from '../src/main/browser/url.js'

describe('normalizeAddress', () => {
  it('keeps explicit schemes', () => {
    expect(normalizeAddress('https://example.com/path')).toBe('https://example.com/path')
    expect(normalizeAddress('about:blank')).toBe('about:blank')
  })

  it('turns host-like input into an HTTPS URL', () => {
    expect(normalizeAddress('example.com/docs')).toBe('https://example.com/docs')
  })

  it.each([
    ['localhost:5173', 'http://localhost:5173'],
    ['app.localhost:4173/dashboard', 'http://app.localhost:4173/dashboard'],
    ['127.0.0.1:8081/ui-kit', 'http://127.0.0.1:8081/ui-kit'],
    ['127.42.0.9:3000', 'http://127.42.0.9:3000'],
    ['[::1]:6006', 'http://[::1]:6006']
  ])('uses HTTP for a scheme-less loopback development address %s', (input, expected) => {
    expect(normalizeAddress(input)).toBe(expected)
  })

  it('turns plain text into a search', () => {
    expect(normalizeAddress('persistent electron browser')).toBe(
      'https://www.google.com/search?q=persistent%20electron%20browser'
    )
  })

  it.each([
    ['duckduckgo', 'https://duckduckgo.com/?q=persistent%20electron%20browser'],
    ['bing', 'https://www.bing.com/search?q=persistent%20electron%20browser'],
    ['brave', 'https://search.brave.com/search?q=persistent%20electron%20browser'],
    ['startpage', 'https://www.startpage.com/sp/search?query=persistent%20electron%20browser']
  ] as const)('uses the selected %s search engine', (engine, expected) => {
    expect(normalizeAddress('persistent electron browser', engine)).toBe(expected)
  })

  it('uses a blank page for empty input', () => {
    expect(normalizeAddress('   ')).toBe('about:blank')
  })
})
