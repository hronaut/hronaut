import { describe, expect, it } from 'vitest'
import { PAGE_METADATA_LIMITS, pageMetadataScript } from '../src/shared/page-metadata.js'

describe('page metadata', () => {
  it('uses explicit bounded collections for search, social, and structured-data metadata', () => {
    expect(PAGE_METADATA_LIMITS).toMatchObject({
      maxCanonicalUrls: 5,
      maxAlternateLinks: 20,
      maxIcons: 10,
      maxSocialImages: 5,
      maxStructuredDataBlocks: 20,
      maxStructuredDataTypes: 50,
      maxStructuredDataNodes: 200
    })
    const script = pageMetadataScript()
    expect(script).toContain('meta[name="description" i]')
    expect(script).toContain("metaProperty('og:title')")
    expect(script).toContain('script[type="application/ld+json" i]')
    expect(script).toContain("value['@type']")
  })

  it('does not collect body content, field values, markup, or arbitrary meta contents', () => {
    const script = pageMetadataScript()
    for (const unsafe of ['document.body', 'innerHTML', 'outerHTML', 'textContent', 'input.value', 'textarea', 'meta[content]']) {
      expect(script).not.toContain(unsafe)
    }
  })
})
