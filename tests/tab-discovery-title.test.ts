import { describe, expect, it } from 'vitest'
import { MAX_RESTORED_DISCOVERY_TITLES, TabDiscoveryTitle } from '../src/main/browser/tab-discovery-title.js'

describe('compact title provenance across native history restoration', () => {
  it('keeps restored display titles unverified across later document transitions and restorations', () => {
    const title = new TabDiscoveryTitle()
    const fallback = 'example.test/?token=private#fragment'
    title.observe('Original authored title', true)
    title.restoring([{ url: 'https://' + fallback, title: fallback }])
    expect(title.value).toBe('')
    title.observe(fallback, true)
    expect(title.value).toBe('')
    title.observe('Fresh authored title', true)
    expect(title.value).toBe('Fresh authored title')
    title.clear()
    title.restoring([{ url: 'https://example.test/other', title: 'Other retained title' }])
    title.observe(fallback, true)
    expect(title.value).toBe('')
    title.observe('Other retained title', true)
    expect(title.value).toBe('')
  })

  it('compares the normalized bounded value, conservatively omitting authored collisions', () => {
    const title = new TabDiscoveryTitle()
    title.restoring([{ url: 'https://example.test', title: '  Restored\nCafe\u0301 ' + 'x'.repeat(600) }])
    title.observe('Restored Café ' + 'x'.repeat(600), true)
    expect(title.value).toBe('')
    title.observe('Distinct authored title', true)
    expect(title.value).toBe('Distinct authored title')
    title.observe('Synthesized', false)
    expect(title.value).toBe('')
    title.observe('   ', true)
    expect(title.value).toBe('')
  })

  it('fails closed for the tab lifetime when the bounded history-title record fills', () => {
    const title = new TabDiscoveryTitle()
    const entries = Array.from({ length: MAX_RESTORED_DISCOVERY_TITLES }, (_, index) => ({ url: 'https://example.test', title: String(index) }))
    title.restoring(entries)
    title.restoring(entries) // Duplicate entries do not consume additional capacity.
    title.observe('Fresh authored title', true)
    expect(title.value).toBe('Fresh authored title')
    title.restoring([{ url: 'https://example.test', title: 'One more' }])
    title.observe('Fresh authored title', true)
    expect(title.value).toBe('')
    title.clear()
    title.restoring([])
    title.observe('0', true)
    expect(title.value).toBe('')
  })
})
