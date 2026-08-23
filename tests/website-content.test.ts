import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BROWSER_TOOL_CATALOG } from '../src/main/mcp/server.js'
import { matchingReleaseAsset, RELEASE_ASSET_MATCHERS } from '../src/shared/release-assets.js'

const websiteHtml = readFileSync(new URL('../website/index.html', import.meta.url), 'utf8')

describe('public website content', () => {
  it('keeps the advertised MCP tool count aligned with the server catalog', () => {
    const count = BROWSER_TOOL_CATALOG.length
    expect(websiteHtml).toContain(`and ${count} MCP tools.`)
    expect(websiteHtml).toContain(`<strong>${count}</strong><span>MCP tools</span>`)
  })

  it('numbers feature cards continuously', () => {
    const numbers = [...websiteHtml.matchAll(/<article><b>(\d+)<\/b><h3>/g)].map((match) => Number(match[1]))
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => index + 1))
    expect(websiteHtml).toContain('id="feature-grid" class="features"')
    expect(websiteHtml).toContain('aria-controls="feature-grid"')
  })

  it('offers every desktop architecture produced by the release workflow', () => {
    expect(Object.keys(RELEASE_ASSET_MATCHERS)).toEqual([
      'windows',
      'mac-arm',
      'mac-x64',
      'linux-x64',
      'linux-arm'
    ])
    expect(websiteHtml.match(/data-download="[^"]+"/g)).toHaveLength(5)
    expect(matchingReleaseAsset([{ name: 'hronaut-1.4.0-x86_64.AppImage' }], 'linux-x64')).toBeDefined()
    expect(matchingReleaseAsset([{ name: 'hronaut-1.4.0-arm64.AppImage' }], 'linux-arm')).toBeDefined()
  })

  it('announces website clipboard results without silently swallowing permission failures', () => {
    expect(websiteHtml).toContain('id="copy-config-status"')
    expect(websiteHtml).toContain('aria-live="polite"')
  })
})
