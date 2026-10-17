import { describe, expect, it } from 'vitest'
import {
  COMMAND_PALETTE_RESULT_LIMITS,
  paletteHistoryIndex,
  paletteOpenAddress,
  searchPaletteHistory,
  searchPaletteSettings,
  searchPaletteTabs
} from '../src/shared/command-palette-search.js'
import type { BrowserHistoryEntry } from '../src/shared/types.js'

function visit(id: string, url: string, title: string, minutesAgo: number): BrowserHistoryEntry {
  return { id, url, title, visitedAt: new Date(Date.UTC(2026, 9, 17, 5, 0) - minutesAgo * 60_000).toISOString(), visitCount: 1 }
}

describe('command palette search', () => {
  it('finds open tabs by title and address, leaving out the tab in view and Home', () => {
    const results = searchPaletteTabs({
      activeTabId: 'current',
      tabs: [
        { id: 'current', title: 'Acme orders', url: 'https://acme.test/orders', mcpGroupId: 'shop' },
        { id: 'home', title: 'Acme Home', url: 'hronaut://home/' },
        { id: 'docs', title: 'API reference', url: 'https://acme.test/docs?token=secret#auth', mcpGroupId: 'shop' }
      ],
      mcpTabGroups: [{ id: 'shop', name: 'Storefront', color: 'blue' }]
    }, 'acme', 'Untitled tab')

    expect(results).toEqual([{ kind: 'tabs', id: 'docs', label: 'API reference', description: 'acme.test/docs · Storefront', score: 5, color: 'blue' }])
  })

  it('lists each visited address once, the best title match first and the newest among equals', () => {
    const index = paletteHistoryIndex([
      visit('old', 'https://acme.test/billing', 'Acme billing', 30),
      visit('new', 'https://acme.test/invoices', 'Acme invoices', 5),
      visit('repeat', 'https://acme.test/billing', 'Acme billing', 1),
      visit('blog', 'https://blog.test/acme', 'Notes about acme', 2)
    ])

    expect(searchPaletteHistory(index, new Set(), 'acme').map((result) => result.id)).toEqual(['repeat', 'new', 'blog'])
  })

  it('leaves out visited pages open in a tab, whatever their fragment or sign-in details', () => {
    const index = paletteHistoryIndex([visit('docs', 'https://acme.test/docs', 'Acme docs', 1)])
    const open = new Set([paletteOpenAddress('https://user:pass@acme.test/docs#section')])

    expect(searchPaletteHistory(index, open, 'acme')).toEqual([])
  })

  it('finds Settings sections by name or description, up to its limit', () => {
    const items = ['General', 'Privacy', 'Passwords', 'Downloads', 'Wallets'].map((label) => ({ section: label.toLowerCase(), label, description: 'Hronaut settings' }))

    expect(searchPaletteSettings(items, 'wallet').map((result) => result.id)).toEqual(['wallets'])
    expect(searchPaletteSettings(items, 'settings')).toHaveLength(COMMAND_PALETTE_RESULT_LIMITS.settings)
  })
})
