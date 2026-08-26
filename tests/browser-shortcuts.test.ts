import { describe, expect, it } from 'vitest'
import { browserShortcutAction, type BrowserShortcutInput } from '../src/shared/browser-shortcuts.js'

function input(overrides: Partial<BrowserShortcutInput> = {}): BrowserShortcutInput {
  return {
    key: '',
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...overrides
  }
}

describe('browserShortcutAction', () => {
  it.each([
    ['L', 'focus-address'],
    ['T', 'new-tab'],
    ['W', 'close-tab'],
    ['F', 'find'],
    ['D', 'bookmark']
  ] as const)('maps the primary modifier plus %s', (key, action) => {
    expect(browserShortcutAction(input({ key, control: true }))).toBe(action)
    expect(browserShortcutAction(input({ key, meta: true }))).toBe(action)
  })

  it('uses Cmd+Y rather than Cmd+H for macOS visit history', () => {
    expect(browserShortcutAction(input({ key: 'H', control: true }))).toBe('visit-history')
    expect(browserShortcutAction(input({ key: 'Y', meta: true }))).toBe('visit-history')
    expect(browserShortcutAction(input({ key: 'H', meta: true }))).toBeNull()
  })

  it('maps reopen and tab-cycling shortcuts', () => {
    expect(browserShortcutAction(input({ key: 'T', control: true, shift: true }))).toBe('reopen-closed-tab')
    expect(browserShortcutAction(input({ key: 'Tab', control: true }))).toBe('next-tab')
    expect(browserShortcutAction(input({ key: 'Tab', control: true, shift: true }))).toBe('previous-tab')
    expect(browserShortcutAction(input({ key: 'Tab', meta: true }))).toBeNull()
  })

  it('maps standard direct-tab shortcuts on Linux, Windows, and macOS', () => {
    for (const modifier of [{ control: true }, { meta: true }]) {
      for (let position = 1; position <= 8; position += 1) {
        expect(browserShortcutAction(input({ key: String(position), ...modifier }))).toBe(`select-tab-${position}`)
      }
      expect(browserShortcutAction(input({ key: '9', ...modifier }))).toBe('select-last-tab')
    }
    expect(browserShortcutAction(input({ key: '1', control: true, shift: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: '9', meta: true, alt: true }))).toBeNull()
  })

  it('maps the standard tab-search shortcut', () => {
    expect(browserShortcutAction(input({ key: 'A', control: true, shift: true }))).toBe('search-tabs')
    expect(browserShortcutAction(input({ key: 'A', meta: true, shift: true }))).toBe('search-tabs')
  })

  it('maps the standard command-palette shortcut', () => {
    expect(browserShortcutAction(input({ key: 'P', control: true, shift: true }))).toBe('command-palette')
    expect(browserShortcutAction(input({ key: 'P', meta: true, shift: true }))).toBe('command-palette')
  })

  it('maps normal and cache-bypassing reload shortcuts', () => {
    expect(browserShortcutAction(input({ key: 'R', control: true }))).toBe('reload')
    expect(browserShortcutAction(input({ key: 'R', meta: true }))).toBe('reload')
    expect(browserShortcutAction(input({ key: 'R', control: true, shift: true }))).toBe('reload-ignoring-cache')
    expect(browserShortcutAction(input({ key: 'R', meta: true, shift: true }))).toBe('reload-ignoring-cache')
  })

  it('maps the standard clear-browsing-data shortcut', () => {
    expect(browserShortcutAction(input({ key: 'Delete', control: true, shift: true }))).toBe('clear-browsing-data')
    expect(browserShortcutAction(input({ key: 'Backspace', meta: true, shift: true }))).toBe('clear-browsing-data')
  })

  it('maps Chromium developer-tools shortcuts', () => {
    expect(browserShortcutAction(input({ key: 'F12' }))).toBe('toggle-devtools')
    expect(browserShortcutAction(input({ key: 'I', control: true, shift: true }))).toBe('toggle-devtools')
    expect(browserShortcutAction(input({ key: 'I', meta: true, alt: true }))).toBe('toggle-devtools')
    expect(browserShortcutAction(input({ key: 'I', control: true }))).toBeNull()
  })

  it('maps Chromium inspect-element shortcuts', () => {
    expect(browserShortcutAction(input({ key: 'C', control: true, shift: true }))).toBe('pick-element')
    expect(browserShortcutAction(input({ key: 'C', meta: true, alt: true }))).toBe('pick-element')
    expect(browserShortcutAction(input({ key: 'C', control: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'C', meta: true, shift: true }))).toBeNull()
  })

  it('maps standard page zoom shortcuts', () => {
    for (const modifier of [{ control: true }, { meta: true }]) {
      expect(browserShortcutAction(input({ key: '+', shift: true, ...modifier }))).toBe('zoom-in')
      expect(browserShortcutAction(input({ key: '=', ...modifier }))).toBe('zoom-in')
      expect(browserShortcutAction(input({ key: '-', ...modifier }))).toBe('zoom-out')
      expect(browserShortcutAction(input({ key: '0', ...modifier }))).toBe('zoom-reset')
    }
  })

  it('ignores unsafe modifier combinations, repeats, and composition', () => {
    expect(browserShortcutAction(input({ key: 'T', control: true, alt: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'W', control: true, shift: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'T', control: true, repeat: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'T', control: true, composing: true }))).toBeNull()
  })
})
