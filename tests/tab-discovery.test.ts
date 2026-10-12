import { describe, expect, it } from 'vitest'
import { compactTabDiscovery, TAB_DISCOVERY_LIMITS } from '../src/main/mcp/tab-discovery.js'

const tab = (id = 'one', title = 'Alpha Billing', url = 'https://example.test/invoices') => ({ id, title, url })

describe('compact tab projection', () => {
  it('does not expose or match authored task labels or change discovery counts', () => {
    const labeled = { ...tab(), label: 'Private customer task', labelDurabilityUnconfirmed: true }
    expect(compactTabDiscovery([labeled], {})).toEqual(compactTabDiscovery([tab()], {}))
    expect(compactTabDiscovery([labeled], { query: 'Private customer task' }).matching).toBe(0)
    expect(JSON.stringify(compactTabDiscovery([labeled], {}))).not.toContain('Private customer task')
  })

  it('matches literal case-insensitive terms within individual projected fields and tabs', () => {
    const tabs = [tab(), tab('two', 'Beta', 'https://reports.test/')]
    expect(compactTabDiscovery(tabs, { query: ' EXAMPLE\nALPHA ' }).tabs).toEqual([tab()])
    for (const query of ['alpha reports', 'billinghttps', '.*', 'absent']) expect(compactTabDiscovery(tabs, { query }).matching).toBe(0)
    expect(compactTabDiscovery(tabs, { query: '\t\n' }).returned).toBe(2)
  })

  it('removes credentials, fragments and recognized secret values before matching', () => {
    const input = tab('one', 'Safe title', 'https://username-canary:password-canary@example.test/path?api_key=key-canary&session=session-canary&view=open#fragment-canary')
    const result = compactTabDiscovery([input], {})
    expect(result.tabs[0]!.url).toBe('https://example.test/path?view=open&api_key=%5BREDACTED%5D&session=%5BREDACTED%5D')
    for (const secret of ['username-canary', 'password-canary', 'key-canary', 'session-canary', 'fragment-canary']) {
      expect(JSON.stringify(result)).not.toContain(secret)
      expect(compactTabDiscovery([input], { query: secret }).matching).toBe(0)
    }
    expect(input.url).toContain('password-canary')
  })

  it('excludes application, unsupported, malformed and oversized addresses from rows and counts', () => {
    const urls = ['hronaut://home', 'about:blank', 'file:///tmp/private', 'data:text/plain,private', 'not a URL', 'https://[broken', 'https://example.test/' + 'x'.repeat(8192)]
    const result = compactTabDiscovery([...urls.map((url, i) => tab(String(i), 'Omitted canary', url)), tab()], {})
    expect(result).toMatchObject({ eligible: 1, matching: 1, returned: 1, tabs: [tab()] })
    expect(compactTabDiscovery(urls.map(url => tab('one', 'Omitted canary', url)), { query: 'canary' }).matching).toBe(0)
  })

  it('projects bounded prefixes before search and reports projection truncation', () => {
    const input = tab('one', 'T'.repeat(160) + 'hidden-title', 'https://example.test/' + 'p'.repeat(512) + 'hidden-path')
    const result = compactTabDiscovery([input], {})
    expect(result.projectionTruncated).toBe(true)
    expect(result.tabs[0]!.title).toHaveLength(160)
    expect(result.tabs[0]!.url).toHaveLength(512)
    for (const query of ['hidden-title', 'hidden-path']) expect(compactTabDiscovery([input], { query }).matching).toBe(0)
  })

  it('retains order and complete matching counts when either limit truncates results', () => {
    const tabs = Array.from({ length: 50 }, (_, i) => tab(String(i), '"'.repeat(160), 'https://example.test/' + 'p'.repeat(512)))
    const limited = compactTabDiscovery(tabs, { limit: 2 })
    expect(limited).toMatchObject({ eligible: 50, matching: 50, returned: 2, truncated: true })
    expect(limited.tabs.map(t => t.id)).toEqual(['0', '1'])
    const bounded = compactTabDiscovery(tabs, { limit: 20 })
    expect(JSON.stringify(bounded, null, 2).length).toBeLessThanOrEqual(16000)
    expect(bounded.returned).toBeLessThan(20)
    expect(bounded.matching).toBe(50)
    expect(bounded.truncated).toBe(true)
  })

  it('never includes nested runtime state and bounds worst-case escaped titles', () => {
    const input = { ...tab(), title: '\u0000'.repeat(160), favicon: 'private-image', dialog: { message: 'private-dialog' } }
    const result = compactTabDiscovery([input], {})
    expect(Object.keys(result.tabs[0]!).sort()).toEqual(['id', 'title', 'url'])
    expect(JSON.stringify(result)).not.toMatch(/private-image|private-dialog|\\u0000/)
    expect(result.limits).toEqual(TAB_DISCOVERY_LIMITS)
  })

  it('rejects workloads beyond the application tab/identity bounds', () => {
    expect(() => compactTabDiscovery(Array.from({ length: 51 }, () => tab()), {})).toThrow('bounds')
    expect(() => compactTabDiscovery([tab('x'.repeat(129))], {})).toThrow('bounds')
  })
})
