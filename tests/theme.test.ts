import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isResolvedThemeName,
  isThemeName,
  RESOLVED_THEME_NAMES,
  themeColorScheme,
  THEME_NAMES
} from '../src/shared/theme.js'

describe('theme contract', () => {
  it('keeps persisted and resolved theme names in one authoritative catalog', () => {
    expect(THEME_NAMES).toEqual([
      'system', 'light', 'dark', 'midnight', 'sepia', 'cyberpunk', 'cyberpunk-turbo', 'matrix', 'machine', 'galactic'
    ])
    expect(RESOLVED_THEME_NAMES).toEqual(THEME_NAMES.slice(1))
    expect(THEME_NAMES.every(isThemeName)).toBe(true)
    expect(RESOLVED_THEME_NAMES.every(isResolvedThemeName)).toBe(true)
    expect(isResolvedThemeName('system')).toBe(false)
  })

  it('uses light native controls only for light-surface themes', () => {
    expect(RESOLVED_THEME_NAMES.map((theme) => [theme, themeColorScheme(theme)])).toEqual([
      ['light', 'light'],
      ['dark', 'dark'],
      ['midnight', 'dark'],
      ['sepia', 'light'],
      ['cyberpunk', 'dark'],
      ['cyberpunk-turbo', 'dark'],
      ['matrix', 'dark'],
      ['machine', 'dark'],
      ['galactic', 'dark']
    ])
  })

  it('defines application tokens and a Settings preview for every resolved theme', () => {
    const tokens = readFileSync(new URL('../src/renderer/src/styles/tokens.css', import.meta.url), 'utf8')
    const settings = readFileSync(new URL('../src/renderer/src/styles/settings.css', import.meta.url), 'utf8')
    const overlay = readFileSync(new URL('../src/renderer/src/address-overlay.css', import.meta.url), 'utf8')

    for (const theme of RESOLVED_THEME_NAMES) {
      expect(tokens).toContain(`:root[data-theme="${theme}"]`)
      expect(settings).toContain(`.theme-${theme}`)
    }
    expect(overlay).toContain("@import './styles/tokens.css' layer(tokens);")
  })
})
