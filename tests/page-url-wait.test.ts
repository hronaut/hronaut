import { describe, expect, it } from 'vitest'
import { normalizePageUrlWaitPattern, pageUrlMatchesWait } from '../src/shared/page-url-wait.js'

describe('page URL waiting', () => {
  it('matches bounded full-URL wildcards for web, internal, and same-document destinations', () => {
    expect(pageUrlMatchesWait('https://example.test/account/*', 'https://example.test/account/ready?step=2#done')).toBe(true)
    expect(pageUrlMatchesWait('hronaut://home/*', 'hronaut://home/settings')).toBe(true)
    expect(pageUrlMatchesWait('about:blank', 'about:blank')).toBe(true)
    expect(pageUrlMatchesWait('https://example.test/account/ready', 'https://example.test/account/pending')).toBe(false)
  })

  it('normalizes a visible bounded pattern and rejects unsafe input', () => {
    expect(normalizePageUrlWaitPattern('  *://example.test/ready*  ')).toBe('*://example.test/ready*')
    expect(() => normalizePageUrlWaitPattern('   ')).toThrow('between 1 and 2,048')
    expect(() => normalizePageUrlWaitPattern(`https://example.test/${'x'.repeat(2_100)}`)).toThrow('2,048')
    expect(() => normalizePageUrlWaitPattern('https://example.test/\nready')).toThrow('control characters')
  })
})
