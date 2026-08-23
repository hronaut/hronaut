import { describe, expect, it } from 'vitest'
import { filterCommandPaletteCommands } from '../src/shared/command-palette.js'

describe('filterCommandPaletteCommands', () => {
  it('keeps global actions available without a website', () => {
    const commands = filterCommandPaletteCommands('', false)
    expect(commands.some((command) => command.id === 'settings')).toBe(true)
    expect(commands.some((command) => command.id === 'capture-area')).toBe(false)
  })

  it('finds commands through descriptions and synonyms', () => {
    expect(filterCommandPaletteCommands('clipboard image', true).map((command) => command.id)).toEqual([
      'capture-area',
      'capture-element',
      'capture-viewport',
      'capture-full-page'
    ])
    expect(filterCommandPaletteCommands('node screenshot', true)[0]?.id).toBe('capture-element')
    expect(filterCommandPaletteCommands('visible screen', true)[0]?.id).toBe('capture-viewport')
    expect(filterCommandPaletteCommands('entire long screenshot', true)[0]?.id).toBe('capture-full-page')
    expect(filterCommandPaletteCommands('page context headings controls', true)[0]?.id).toBe('copy-snapshot')
    expect(filterCommandPaletteCommands('cookies cache', true).map((command) => command.id)).toContain('privacy')
    expect(filterCommandPaletteCommands('wcag', true)[0]?.id).toBe('accessibility')
    expect(filterCommandPaletteCommands('unused code', true)[0]?.id).toBe('coverage')
    expect(filterCommandPaletteCommands('slow function', true)[0]?.id).toBe('cpu-profile')
    expect(filterCommandPaletteCommands('retained allocation leak', true)[0]?.id).toBe('memory')
    expect(filterCommandPaletteCommands('pause animations', true)[0]?.id).toBe('environment')
    expect(filterCommandPaletteCommands('certificate cipher', true)[0]?.id).toBe('security')
    expect(filterCommandPaletteCommands('css palette fonts', true)[0]?.id).toBe('design-overview')
    expect(filterCommandPaletteCommands('seo json-ld robots', true)[0]?.id).toBe('page-metadata')
    expect(filterCommandPaletteCommands('console messages errors', true)[0]?.id).toBe('console')
    expect(filterCommandPaletteCommands('offline dark mode geolocation', true)[0]?.id).toBe('environment')
    expect(filterCommandPaletteCommands('print forced colors vision deficiency', true)[0]?.id).toBe('environment')
    expect(filterCommandPaletteCommands('locale timezone language', true)[0]?.id).toBe('environment')
    expect(filterCommandPaletteCommands('data saver', true)[0]?.id).toBe('environment')
    expect(filterCommandPaletteCommands('disable cache service worker', true)[0]?.id).toBe('environment')
    expect(filterCommandPaletteCommands('disable javascript no js', true)[0]?.id).toBe('environment')
    expect(filterCommandPaletteCommands('timeout override request', true)[0]?.id).toBe('request-conditions')
    expect(filterCommandPaletteCommands('priority reorder', true)[0]?.id).toBe('request-conditions')
    expect(filterCommandPaletteCommands('individual throttle slow api', true)[0]?.id).toBe('request-conditions')
    expect(filterCommandPaletteCommands('mutation attribute node', true)[0]?.id).toBe('dom-changes')
    expect(filterCommandPaletteCommands('inspect selector', true)[0]).toMatchObject({
      id: 'pick-element',
      shortcut: 'Ctrl+Shift+C / Cmd+Option+C'
    })
  })

  it('ranks exact and prefix label matches ahead of indirect matches', () => {
    expect(filterCommandPaletteCommands('network', true)[0]?.id).toBe('network')
    expect(filterCommandPaletteCommands('open page', true)[0]?.id).toBe('page-tools')
  })
})
