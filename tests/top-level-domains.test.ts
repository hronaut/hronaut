import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TOP_LEVEL_DOMAINS_MODULE, topLevelDomainsModule } from '../scripts/update-top-level-domains.js'
import { TOP_LEVEL_DOMAINS } from '../src/main/browser/top-level-domains.js'

const ianaList = (domains: string[], version = '2026110304') => [`# Version ${version}, Last Updated Wed Nov  4 07:07:01 2026 UTC`,
  ...domains.map((domain) => domain.toUpperCase())].join('\n')
// Made-up domains of letters only, as many as a real list holds.
const many = Array.from({ length: 1_200 }, (_, index) => `tld${[...index.toString(26)].map((digit) => String.fromCharCode(97 + parseInt(digit, 26))).join('')}`)

describe('the top-level domains the address bar knows', () => {
  it('are written as the update script writes IANA\'s list', () => {
    const committed = readFileSync(TOP_LEVEL_DOMAINS_MODULE, 'utf8')
    const version = /\(Version (\d+)\)/.exec(committed)?.[1]
    expect(version).toBeDefined()
    expect(topLevelDomainsModule(ianaList([...TOP_LEVEL_DOMAINS], version))).toBe(committed)
  })

  it('hold the root zone\'s domains, internationalized ones in their xn-- form, and not file extensions', () => {
    expect(TOP_LEVEL_DOMAINS.size).toBeGreaterThan(1_000)
    for (const domain of ['com', 'org', 'uk', 'dev', 'app', 'md', 'arpa', 'xn--fiqs8s']) expect(TOP_LEVEL_DOMAINS.has(domain)).toBe(true)
    for (const domain of ['js', 'html', 'json', 'lan', 'local', 'test', 'example', 'invalid', 'localhost']) {
      expect(TOP_LEVEL_DOMAINS.has(domain)).toBe(false)
    }
  })

  it('are written in lowercase, sorted, once each and in short lines', () => {
    const module = topLevelDomainsModule(ianaList(['ZW', 'COM', 'XN--FIQS8S', 'com', ...many]))
    expect(module).toContain('(Version 2026110304)')
    const written = /new Set\(`\n([\s\S]*)\n`/.exec(module)![1]!
    const domains = written.split(/\s+/)
    expect(domains).toEqual([...new Set(['zw', 'com', 'xn--fiqs8s', ...many])].sort())
    expect(Math.max(...written.split('\n').map((line) => line.length))).toBeLessThanOrEqual(120)
  })

  it('refuse a list without its version, with a line that is no domain, or too short to be the root zone', () => {
    expect(() => topLevelDomainsModule(['COM', ...many].join('\n'))).toThrow('starts with no version')
    expect(() => topLevelDomainsModule(ianaList(['<script>', ...many]))).toThrow('unexpected line: <script>')
    expect(() => topLevelDomainsModule(ianaList(['com', 'org']))).toThrow('only 2 domains')
  })
})
