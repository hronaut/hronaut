import { describe, expect, it } from 'vitest'
import { DOM_CHANGES_LIMITS, domChangesPageScript } from '../src/shared/dom-changes.js'

describe('DOM changes recorder', () => {
  it('keeps its structural evidence bounded', () => {
    expect(DOM_CHANGES_LIMITS).toEqual({
      maxEntries: 200,
      maxSelectorChars: 512,
      maxAttributeNameChars: 64,
      maxTagNameChars: 64,
      maxTagsPerEntry: 8
    })
    const script = domChangesPageScript('start')
    expect(script).toContain('MutationObserver')
    expect(script).toContain("attributes: true")
    expect(script).toContain("characterData: true")
    expect(script).toContain('maxEntries')
  })

  it('never reads page text, markup, field values, IDs, classes, or attribute values', () => {
    const script = domChangesPageScript('start')
    for (const unsafe of [
      'textContent',
      'innerHTML',
      'outerHTML',
      'className',
      'getAttribute',
      'oldValue'
    ]) expect(script).not.toContain(unsafe)
    expect(script).not.toMatch(/\.value\b/)
    expect(script).not.toMatch(/\.id\b/)
  })

  it('supports the complete recorder lifecycle', () => {
    for (const action of ['start', 'get', 'stop', 'clear'] as const) {
      expect(domChangesPageScript(action)).toContain(`const action = \"${action}\"`)
    }
  })
})
