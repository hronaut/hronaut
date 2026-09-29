/// <reference lib="dom" />
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { PAGE_METADATA_LIMITS, pageMetadataScript } from '../src/shared/page-metadata.js'

describe('page metadata', () => {
  afterEach(() => { document.head.innerHTML = '' })

  it('associates sparse image properties with their preceding Open Graph image', () => {
    document.head.innerHTML = `
      <meta property="og:image" content="https://example.test/first.png">
      <meta property="og:image:width" content="300">
      <meta property="og:image" content="https://example.test/second.png">
      <meta property="og:image:url" content="https://example.test/third.png">
      <meta property="og:image:height" content="1000">
      <meta property="og:image:alt" content="Third image">
    `
    const report = globalThis.eval(pageMetadataScript())
    expect(report.openGraph.images).toEqual([
      { url: 'https://example.test/first.png', alt: null, width: '300', height: null },
      { url: 'https://example.test/second.png', alt: null, width: null, height: null },
      { url: 'https://example.test/third.png', alt: 'Third image', width: null, height: '1000' }
    ])
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'missing-og-image-alt' }))
  })

  it('does not attach orphaned or empty-root image properties to another image', () => {
    document.head.innerHTML = `
      <meta property="og:image:alt" content="Orphan">
      <meta property="OG:IMAGE" content="https://example.test/first.png">
      <meta property="og:image" content="">
      <meta property="og:image:alt" content="Empty root">
      <meta property="og:image" content="https://example.test/second.png">
      <meta property="og:video" content="https://example.test/movie.mp4">
      <meta property="og:image:height" content="1000">
    `
    expect(globalThis.eval(pageMetadataScript()).openGraph.images).toEqual([
      { url: 'https://example.test/first.png', alt: null, width: null, height: null },
      { url: 'https://example.test/second.png', alt: null, width: null, height: null }
    ])
  })

  it('keeps image limits without assigning omitted image metadata to the final included image', () => {
    document.head.innerHTML = Array.from({ length: 6 }, (_, index) =>
      `<meta property="og:image" content="https://example.test/${index}.png">`
    ).join('') + '<meta property="og:image:alt" content="Sixth image">'
    const images = globalThis.eval(pageMetadataScript()).openGraph.images
    expect(images).toHaveLength(PAGE_METADATA_LIMITS.maxSocialImages)
    expect(images.every((image: { alt: string | null }) => image.alt === null)).toBe(true)
  })

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
