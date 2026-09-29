/// <reference lib="dom" />
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { OMITTED_METADATA_URL, PAGE_METADATA_LIMITS, pageMetadataScript } from '../src/shared/page-metadata.js'
import { PageMetadataController } from '../src/main/browser/diagnostics/page-metadata-controller.js'

async function inspectMetadata() {
  const tab = { id: 'tab-one', url: location.href, navigationGeneration: 0,
    webContents: { executeJavaScriptInIsolatedWorld: async () => globalThis.eval(pageMetadataScript()), isDestroyed: () => false } }
  return new PageMetadataController({ getTab: () => tab, findTab: () => tab }).inspect(tab.id)
}

describe('page metadata', () => {
  afterEach(() => { document.head.innerHTML = '' })

  it('omits oversized metadata URLs before truncation can expose credentials as a hostname', async () => {
    const url = `https://synthetic-private-${'x'.repeat(2_100)}@example.test/app`
    document.head.innerHTML = `
      <link rel="canonical" href="${url}">
      <link rel="manifest" href="${url}">
      <link rel="alternate" hreflang="en" href="${url}">
      <link rel="icon" href="${url}">
      <meta property="og:url" content="${url}">
      <meta property="og:image" content="${url}">
      <meta name="twitter:image" content="${url}">
    `
    const report = await inspectMetadata()
    expect(report.document.canonicalUrls).toEqual([OMITTED_METADATA_URL])
    expect(report.document.manifestUrl).toBe(OMITTED_METADATA_URL)
    expect(report.alternateLinks[0]?.url).toBe(OMITTED_METADATA_URL)
    expect(report.icons[0]?.url).toBe(OMITTED_METADATA_URL)
    expect(report.openGraph.url).toBe(OMITTED_METADATA_URL)
    expect(report.openGraph.images[0]?.url).toBe(OMITTED_METADATA_URL)
    expect(report.twitter.images[0]?.url).toBe(OMITTED_METADATA_URL)
    expect(JSON.stringify(report)).not.toContain('synthetic-private')
  })

  it('resolves relative metadata against the original page when its URL exceeds the limit', async () => {
    const previousUrl = location.href
    try {
      history.replaceState(null, '', `/${'x'.repeat(2_100)}`)
      document.head.innerHTML = '<meta property="og:image" content="/image.png?token=private">'
      const report = await inspectMetadata()
      expect(report.url).toBe(OMITTED_METADATA_URL)
      expect(report.openGraph.images[0]?.url).toBe(`${location.origin}/image.png?token=%5BREDACTED%5D`)
    } finally {
      history.replaceState(null, '', previousUrl)
    }
  })

  it('preserves metadata URLs at the limit and omits only oversized values', async () => {
    const prefix = 'https://example.test/'
    const url = prefix + 'x'.repeat(PAGE_METADATA_LIMITS.maxUrlChars - prefix.length)
    document.head.innerHTML = `<meta property="og:image" content="${url}"><meta property="og:image" content="${url}x">`
    const report = await inspectMetadata()
    expect(report.openGraph.images.map(image => image.url)).toEqual([url, OMITTED_METADATA_URL])
  })

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

  it('reports repeated JSON-LD types independently for each block', () => {
    document.head.innerHTML = [
      { '@type': 'Organization' },
      { '@graph': [{ '@type': 'Organization' }, { '@type': ['Organization', 'WebSite'] }] }
    ].map((value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`).join('')
    const result = globalThis.eval(pageMetadataScript()).structuredData
    expect(result.types).toEqual(['Organization', 'WebSite'])
    expect(result.blocks).toEqual([
      { index: 0, valid: true, types: ['Organization'] },
      { index: 1, valid: true, types: ['Organization', 'WebSite'] }
    ])
  })

  it('keeps block types independent of the capped page-wide type summary', () => {
    const types = Array.from({ length: PAGE_METADATA_LIMITS.maxStructuredDataTypes }, (_, i) => `Type${i}`)
    document.head.innerHTML = [
      { '@type': types },
      { '@type': ['Type0', 'LaterType'] }
    ].map((value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`).join('')
    const result = globalThis.eval(pageMetadataScript()).structuredData
    expect(result.types).toEqual(types)
    expect(result.blocks).toEqual([
      { index: 0, valid: true, types },
      { index: 1, valid: true, types: ['Type0', 'LaterType'] }
    ])
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
