import { describe, expect, it } from 'vitest'
import { browserShortcutAction, shortcutKey, type BrowserShortcutInput } from '../src/shared/browser-shortcuts.js'

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

  it.each(['f', 'w', 'r', 't', 'd', 'l', 'h', 'k', 'y', 'o', 'i', 'c', '=', '+', '-', '0', '.', 'Delete', 'Backspace', 'R', 'T', 'A', 'P', 'O', 'I', 'C'])(
    'leaves Control+%s to the page on macOS, where Command is the browser key', key => {
      // Control+F opened Find instead of moving the caret, and Control+W in a web terminal closed the tab.
      for (const shift of [false, true]) {
        expect(browserShortcutAction(input({ key, control: true, shift, mac: true }))).toBeNull()
        expect(browserShortcutAction(input({ key, control: true, meta: true, shift, mac: true }))).toBeNull()
      }
    }
  )

  it('keeps the Command keys and Control+Tab on macOS', () => {
    const mac = (overrides: Partial<BrowserShortcutInput>) => browserShortcutAction(input({ mac: true, ...overrides }))
    expect(mac({ key: 'f', meta: true })).toBe('find')
    expect(mac({ key: 'w', meta: true })).toBe('close-tab')
    expect(mac({ key: '=', meta: true })).toBe('zoom-in')
    expect(mac({ key: 'T', meta: true, shift: true })).toBe('reopen-closed-tab')
    expect(mac({ key: 'y', meta: true })).toBe('visit-history')
    expect(mac({ key: '3', code: 'Digit3', meta: true })).toBe('select-tab-3')
    expect(mac({ key: 'Tab', control: true })).toBe('next-tab')
    expect(mac({ key: 'Tab', control: true, shift: true })).toBe('previous-tab')
    expect(mac({ key: 'I', meta: true, alt: true })).toBe('toggle-devtools')
    expect(mac({ key: '2', code: 'Digit2', control: true })).toBe('select-workspace-2')
    expect(mac({ key: 'C', meta: true, alt: true })).toBe('pick-element')
    expect(mac({ key: 'F12' })).toBe('toggle-devtools')
    expect(mac({ key: 'Backspace', meta: true, shift: true })).toBe('clear-browsing-data')
    expect(mac({ key: 'O', meta: true, shift: true })).toBe('take-over')
  })

  it('leaves Control with a keypad digit to the page on macOS', () => {
    // Control+keypad 1 selected the first tab and Control+keypad 0 reset the zoom.
    expect(browserShortcutAction(input({ key: '1', code: 'Numpad1', control: true, mac: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: '0', code: 'Numpad0', control: true, mac: true }))).toBeNull()
  })

  it('keeps Control+Shift+I and Control+Shift+C for Developer Tools on Linux and Windows only', () => {
    expect(browserShortcutAction(input({ key: 'I', control: true, shift: true }))).toBe('toggle-devtools')
    expect(browserShortcutAction(input({ key: 'C', control: true, shift: true }))).toBe('pick-element')
    expect(browserShortcutAction(input({ key: 'I', control: true, shift: true, mac: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'C', control: true, shift: true, mac: true }))).toBeNull()
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

  it('opens the agent card with the primary modifier plus period, and nothing else', () => {
    expect(browserShortcutAction(input({ key: '.', control: true }))).toBe('agent-card')
    expect(browserShortcutAction(input({ key: '.', meta: true }))).toBe('agent-card')
    expect(browserShortcutAction(input({ key: '.' }))).toBeNull()
    expect(browserShortcutAction(input({ key: '.', control: true, shift: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: '.', control: true, alt: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: '.', control: true, repeat: true }))).toBeNull()
  })

  it('takes over from the agent with the primary modifier plus Shift+O', () => {
    expect(browserShortcutAction(input({ key: 'O', control: true, shift: true }))).toBe('take-over')
    expect(browserShortcutAction(input({ key: 'o', meta: true, shift: true }))).toBe('take-over')
    expect(browserShortcutAction(input({ key: 'o', control: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'O', control: true, shift: true, alt: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'O', control: true, shift: true, repeat: true }))).toBeNull()
  })

  it('switches workspace with the primary modifier plus K, and nothing else on K', () => {
    expect(browserShortcutAction(input({ key: 'k', control: true }))).toBe('switch-workspace')
    expect(browserShortcutAction(input({ key: 'K', meta: true }))).toBe('switch-workspace')
    expect(browserShortcutAction(input({ key: 'k' }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'k', control: true, shift: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'k', control: true, alt: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'k', control: true, repeat: true }))).toBeNull()
  })

  it('toggles the full-page view with the primary modifier plus Shift+F, leaving Find on F', () => {
    expect(browserShortcutAction(input({ key: 'F', control: true, shift: true }))).toBe('toggle-full-page')
    expect(browserShortcutAction(input({ key: 'F', meta: true, shift: true }))).toBe('toggle-full-page')
    expect(browserShortcutAction(input({ key: 'f', control: true }))).toBe('find')
    expect(browserShortcutAction(input({ key: 'F', shift: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'F', control: true, shift: true, alt: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'F', meta: true, shift: true, repeat: true }))).toBeNull()
  })

  it('maps standard page zoom shortcuts', () => {
    for (const modifier of [{ control: true }, { meta: true }]) {
      expect(browserShortcutAction(input({ key: '+', shift: true, ...modifier }))).toBe('zoom-in')
      expect(browserShortcutAction(input({ key: '=', ...modifier }))).toBe('zoom-in')
      expect(browserShortcutAction(input({ key: '-', ...modifier }))).toBe('zoom-out')
      expect(browserShortcutAction(input({ key: '0', ...modifier }))).toBe('zoom-reset')
    }
  })

  // Electron reports the character the layout types, so with a Russian or Ukrainian layout on Ctrl+L came as Ctrl+д and
  // no browser key worked. Chrome goes by the key's place on a US keyboard for such layouts.
  it.each([
    ['д', 'KeyL', false, 'focus-address'],
    ['е', 'KeyT', false, 'new-tab'],
    ['ц', 'KeyW', false, 'close-tab'],
    ['а', 'KeyF', false, 'find'],
    ['в', 'KeyD', false, 'bookmark'],
    ['к', 'KeyR', false, 'reload'],
    ['л', 'KeyK', false, 'switch-workspace'],
    ['ю', 'Period', false, 'agent-card'],
    ['Е', 'KeyT', true, 'reopen-closed-tab'],
    ['Ф', 'KeyA', true, 'search-tabs'],
    ['З', 'KeyP', true, 'command-palette'],
    ['К', 'KeyR', true, 'reload-ignoring-cache'],
    ['А', 'KeyF', true, 'toggle-full-page'],
    ['Щ', 'KeyO', true, 'take-over'],
    ['Ш', 'KeyI', true, 'toggle-devtools'],
    ['С', 'KeyC', true, 'pick-element'],
    ['і', 'KeyS', false, null],
    ['λ', 'KeyL', false, 'focus-address']
  ] as const)('maps Control+%s at %s (Shift %s) by its place on a US keyboard', (key, code, shift, action) => {
    expect(browserShortcutAction(input({ key, code, shift, control: true }))).toBe(action)
    if (action && !['toggle-devtools', 'pick-element'].includes(action)) {
      expect(browserShortcutAction(input({ key, code, shift, meta: true, mac: true }))).toBe(action)
    }
  })

  it('goes by the US key for history, tabs and zoom when the layout types other characters there', () => {
    expect(browserShortcutAction(input({ key: 'р', code: 'KeyH', control: true }))).toBe('visit-history')
    expect(browserShortcutAction(input({ key: 'н', code: 'KeyY', meta: true, mac: true }))).toBe('visit-history')
    // Czech types ě on the 2 key and AZERTY à on the 0 key.
    expect(browserShortcutAction(input({ key: 'ě', code: 'Digit2', control: true }))).toBe('select-tab-2')
    expect(browserShortcutAction(input({ key: 'à', code: 'Digit0', control: true }))).toBe('zoom-reset')
  })

  it('keeps the letters of a Latin layout and Control with a letter for the page on macOS', () => {
    // AZERTY types a on the US Q key and q on the US A key; Dvorak types l on the US P key.
    expect(browserShortcutAction(input({ key: 'A', code: 'KeyQ', control: true, shift: true }))).toBe('search-tabs')
    expect(browserShortcutAction(input({ key: 'Q', code: 'KeyA', control: true, shift: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'l', code: 'KeyP', control: true }))).toBe('focus-address')
    expect(browserShortcutAction(input({ key: 'p', code: 'KeyL', control: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'д', code: 'KeyL', control: true, mac: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'д', code: 'KeyL' }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'д', code: 'KeyL', control: true, alt: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'д', code: 'KeyL', control: true, repeat: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'д', control: true }))).toBeNull()
  })

  it('names the key a shortcut goes by', () => {
    expect(shortcutKey({ key: 'Я', code: 'KeyZ' })).toBe('z')
    expect(shortcutKey({ key: 'Z', code: 'KeyY' })).toBe('z')
    expect(shortcutKey({ key: 'Tab', code: 'Tab' })).toBe('tab')
    expect(shortcutKey({ key: 'ю', code: 'Period' })).toBe('.')
    expect(shortcutKey({ key: 'ж', code: 'Semicolon' })).toBe(';')
    expect(shortcutKey({ key: 'ж' })).toBe('ж')
    expect(shortcutKey({ key: 'ö', code: 'IntlBackslash' })).toBe('ö')
  })

  it('ignores unsafe modifier combinations, repeats, and composition', () => {
    expect(browserShortcutAction(input({ key: 'T', control: true, alt: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'W', control: true, shift: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'T', control: true, repeat: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'T', control: true, composing: true }))).toBeNull()
  })
})
