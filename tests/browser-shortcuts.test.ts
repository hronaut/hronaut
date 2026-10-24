import { describe, expect, it } from 'vitest'
import { applicationMenuKey, browserShortcutAction, isBrowserKey, websiteKeptShortcutAction, type BrowserShortcutInput } from '../src/shared/browser-shortcuts.js'
import { shortcutKey } from '../src/shared/shortcut-key.js'

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
    // On macOS Option+I is a dead key, so it goes by the key's place.
    expect(browserShortcutAction(input({ key: 'Dead', code: 'KeyI', meta: true, alt: true, mac: true }))).toBe('toggle-devtools')
    expect(browserShortcutAction(input({ key: 'Dead', code: 'KeyU', meta: true, alt: true, mac: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'I', control: true }))).toBeNull()
  })

  it('maps Chromium inspect-element shortcuts', () => {
    expect(browserShortcutAction(input({ key: 'C', control: true, shift: true }))).toBe('pick-element')
    expect(browserShortcutAction(input({ key: 'C', meta: true, alt: true }))).toBe('pick-element')
    // On macOS Option+C types ç.
    expect(browserShortcutAction(input({ key: 'ç', code: 'KeyC', meta: true, alt: true, mac: true }))).toBe('pick-element')
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
    // Other Latin letters keep their own too: Turkish F types ı on the US R key, German ß and Hungarian ü sit on the
    // minus key, and Hungarian ó on the equals key. Chrome gives none of them a browser key.
    expect(browserShortcutAction(input({ key: 'ı', code: 'KeyR', control: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'ß', code: 'Minus', control: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'ü', code: 'Minus', meta: true, mac: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'ó', code: 'Equal', control: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'ç', code: 'Period', control: true }))).toBeNull()
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
    expect(shortcutKey({ key: 'ı', code: 'KeyR' })).toBe('ı')
    expect(shortcutKey({ key: 'é', code: 'Digit2' })).toBe('2')
    expect(shortcutKey({ key: 'ש', code: 'KeyA' })).toBe('a')
  })

  it('ignores unsafe modifier combinations, repeats, and composition', () => {
    expect(browserShortcutAction(input({ key: 'T', control: true, alt: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'W', control: true, shift: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'T', control: true, repeat: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'T', control: true, composing: true }))).toBeNull()
  })
})

describe('Ctrl+F4', () => {
  // It did nothing, where Chrome closes the tab on Windows and Linux as with Ctrl+W.
  it('closes the tab elsewhere than macOS, and a held one closes only one', () => {
    expect(browserShortcutAction(input({ key: 'F4', code: 'F4', control: true }))).toBe('close-tab')
    expect(browserShortcutAction(input({ key: 'F4', code: 'F4', control: true, repeat: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'F4', code: 'F4', control: true, shift: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'F4', code: 'F4', control: true, meta: true }))).toBeNull()
    // Alt+F4 closes the window, which the system does.
    expect(browserShortcutAction(input({ key: 'F4', code: 'F4', alt: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'F4', code: 'F4', control: true, alt: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'F4', code: 'F4' }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'F4', code: 'F4', control: true, mac: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'F4', code: 'F4', meta: true, mac: true }))).toBeNull()
  })
})

describe('Chrome\'s other keys for changing tabs', () => {
  // Ctrl+Page Down and, on macOS, Cmd+Shift+] or Cmd+Option+Right did nothing, where Chrome has them.
  const keys = (overrides: Partial<BrowserShortcutInput>) => browserShortcutAction(input(overrides))

  it('goes to the next and previous tab with Ctrl+Page Down and Ctrl+Page Up elsewhere than macOS', () => {
    expect(keys({ key: 'PageDown', control: true })).toBe('next-tab')
    expect(keys({ key: 'PageUp', control: true })).toBe('previous-tab')
    // Ctrl+Shift with these keys moves the tab once the website leaves them alone; Page Down alone scrolls the page.
    expect(keys({ key: 'PageDown', control: true, shift: true })).toBeNull()
    expect(keys({ key: 'PageDown' })).toBeNull()
    expect(keys({ key: 'PageDown', meta: true })).toBeNull()
    expect(keys({ key: 'PageDown', control: true, repeat: true })).toBeNull()
    // Control with a key stays with the website or field on macOS.
    expect(keys({ key: 'PageDown', control: true, mac: true })).toBeNull()
  })

  it('goes to the next and previous tab with Cmd+Shift+] and Cmd+Shift+[ or Cmd+Option+Right and Left on macOS', () => {
    const mac = (overrides: Partial<BrowserShortcutInput>) => keys({ mac: true, meta: true, ...overrides })
    expect(mac({ key: '}', code: 'BracketRight', shift: true })).toBe('next-tab')
    expect(mac({ key: '{', code: 'BracketLeft', shift: true })).toBe('previous-tab')
    expect(mac({ key: ']', code: 'BracketRight', shift: true })).toBe('next-tab')
    expect(mac({ key: 'ArrowRight', alt: true })).toBe('next-tab')
    expect(mac({ key: 'ArrowLeft', alt: true })).toBe('previous-tab')
    // A layout whose bracket key types a letter, such as German ü, gains no tab key.
    expect(mac({ key: 'Ü', code: 'BracketLeft', shift: true })).toBeNull()
    // Cmd+[ and Cmd+] go back and forward, and Cmd with an arrow moves the caret to the line's start or end.
    expect(mac({ key: '[', code: 'BracketLeft' })).toBeNull()
    expect(mac({ key: ']', code: 'BracketRight' })).toBeNull()
    expect(mac({ key: 'ArrowRight' })).toBeNull()
    expect(mac({ key: 'ArrowRight', alt: true, control: true })).toBeNull()
    // Elsewhere these are no browser keys.
    expect(keys({ key: '}', code: 'BracketRight', shift: true, control: true })).toBeNull()
    expect(keys({ key: 'ArrowRight', alt: true })).toBeNull()
  })
})

describe('Chrome\'s keys a website may keep', () => {
  // F5, Shift+F5, Ctrl+F5 and Alt+D did nothing in Hronaut, where Chrome reloads or goes to the address bar.
  const kept = (overrides: Partial<BrowserShortcutInput>) => websiteKeptShortcutAction(input(overrides))

  it('are no browser keys a page loses before it sees them', () => {
    // A web editor runs F5 as its debugger and a web terminal reads Alt+D.
    for (const key of [{ key: 'F5' }, { key: 'F5', shift: true }, { key: 'F5', control: true }, { key: 'd', code: 'KeyD', alt: true }, { key: 'F6' }, { key: 'F6', shift: true }, { key: 'e', code: 'KeyE', control: true }, { key: 'Home', code: 'Home', alt: true }]) {
      expect(browserShortcutAction(input(key))).toBeNull()
    }
  })

  it('reload with F5, and without the cache with Shift+F5 or Ctrl+F5, elsewhere than macOS', () => {
    expect(kept({ key: 'F5' })).toBe('reload')
    expect(kept({ key: 'F5', shift: true })).toBe('reload-ignoring-cache')
    expect(kept({ key: 'F5', control: true })).toBe('reload-ignoring-cache')
    expect(kept({ key: 'F5', control: true, shift: true })).toBeNull()
    expect(kept({ key: 'F5', alt: true })).toBeNull()
    expect(kept({ key: 'F5', meta: true })).toBeNull()
    expect(kept({ key: 'F5', mac: true })).toBeNull()
    expect(kept({ key: 'F5', repeat: true })).toBeNull()
    expect(kept({ key: 'F5', composing: true })).toBeNull()
  })

  it('go to the address bar with Alt+D elsewhere than macOS, in every layout', () => {
    expect(kept({ key: 'd', code: 'KeyD', alt: true })).toBe('focus-address')
    expect(kept({ key: 'в', code: 'KeyD', alt: true })).toBe('focus-address')
    // AltGr is Ctrl+Alt on Windows and types characters; Option with D types ∂ on macOS.
    expect(kept({ key: 'd', code: 'KeyD', alt: true, control: true })).toBeNull()
    expect(kept({ key: 'D', code: 'KeyD', alt: true, shift: true })).toBeNull()
    expect(kept({ key: 'd', code: 'KeyD' })).toBeNull()
    expect(kept({ key: '∂', code: 'KeyD', alt: true, mac: true })).toBeNull()
  })

  it('go to the address bar with Ctrl+E elsewhere than macOS, in every layout', () => {
    // A web document editor centres a paragraph with Ctrl+E, as Chrome lets it.
    expect(kept({ key: 'e', code: 'KeyE', control: true })).toBe('focus-address')
    expect(kept({ key: 'у', code: 'KeyE', control: true })).toBe('focus-address')
    expect(kept({ key: 'E', code: 'KeyE', control: true, shift: true })).toBeNull()
    expect(kept({ key: 'e', code: 'KeyE', control: true, alt: true })).toBeNull()
    expect(kept({ key: 'e', code: 'KeyE', alt: true })).toBeNull()
    expect(kept({ key: 'e', code: 'KeyE' })).toBeNull()
    expect(kept({ key: 'e', code: 'KeyE', control: true, repeat: true })).toBeNull()
    // On macOS Control+E moves the caret to the end of the line, and Chrome has no Cmd+E for the address bar.
    expect(kept({ key: 'e', code: 'KeyE', control: true, mac: true })).toBeNull()
    expect(kept({ key: 'e', code: 'KeyE', meta: true, mac: true })).toBeNull()
    expect(browserShortcutAction(input({ key: 'e', code: 'KeyE', meta: true, mac: true }))).toBeNull()
  })

  it('open Home with Alt+Home elsewhere than macOS', () => {
    expect(kept({ key: 'Home', code: 'Home', alt: true })).toBe('open-home')
    expect(kept({ key: 'Home', code: 'Home' })).toBeNull()
    expect(kept({ key: 'Home', code: 'Home', alt: true, shift: true })).toBeNull()
    expect(kept({ key: 'Home', code: 'Home', alt: true, control: true })).toBeNull()
    expect(kept({ key: 'Home', code: 'Home', control: true })).toBeNull()
    expect(kept({ key: 'Home', code: 'Home', alt: true, meta: true })).toBeNull()
    expect(kept({ key: 'Home', code: 'Home', alt: true, repeat: true })).toBeNull()
    expect(kept({ key: 'Home', code: 'Home', alt: true, mac: true })).toBeNull()
  })

  it('go to the next pane with F6 or Shift+F6 elsewhere than macOS', () => {
    expect(kept({ key: 'F6' })).toBe('focus-next-pane')
    expect(kept({ key: 'F6', shift: true })).toBe('focus-next-pane')
    expect(kept({ key: 'F6', control: true })).toBeNull()
    expect(kept({ key: 'F6', alt: true })).toBeNull()
    expect(kept({ key: 'F6', meta: true })).toBeNull()
    expect(kept({ key: 'F6', repeat: true })).toBeNull()
    expect(kept({ key: 'F6', mac: true })).toBeNull()
  })

  it('find the next match with F3 or Ctrl+G, and the previous one with Shift, elsewhere than macOS', () => {
    // A web editor goes to a line with Ctrl+G, so these are no browser keys a page loses before it sees them.
    for (const key of [{ key: 'F3' }, { key: 'F3', shift: true }, { key: 'g', code: 'KeyG', control: true }, { key: 'G', code: 'KeyG', control: true, shift: true }]) {
      expect(browserShortcutAction(input(key))).toBeNull()
    }
    expect(kept({ key: 'F3' })).toBe('find-next')
    expect(kept({ key: 'F3', shift: true })).toBe('find-previous')
    expect(kept({ key: 'g', code: 'KeyG', control: true })).toBe('find-next')
    expect(kept({ key: 'G', code: 'KeyG', control: true, shift: true })).toBe('find-previous')
    expect(kept({ key: 'п', code: 'KeyG', control: true })).toBe('find-next')
    expect(kept({ key: 'g', code: 'KeyG' })).toBeNull()
    expect(kept({ key: 'F3', control: true })).toBeNull()
    expect(kept({ key: 'F3', alt: true })).toBeNull()
    expect(kept({ key: 'g', code: 'KeyG', control: true, alt: true })).toBeNull()
    expect(kept({ key: 'F3', repeat: true })).toBeNull()
    // On macOS Cmd+G reaches the Edit menu's Find Next instead.
    expect(kept({ key: 'g', code: 'KeyG', meta: true, mac: true })).toBeNull()
    expect(kept({ key: 'F3', mac: true })).toBeNull()
  })

  it('move the tab with Ctrl+Shift+Page Down and Ctrl+Shift+Page Up elsewhere than macOS', () => {
    // A web code editor moves its own editor tab with these keys, as Chrome lets it.
    expect(kept({ key: 'PageDown', control: true, shift: true })).toBe('move-tab-next')
    expect(kept({ key: 'PageUp', control: true, shift: true })).toBe('move-tab-previous')
    expect(kept({ key: 'PageDown', shift: true })).toBeNull()
    expect(kept({ key: 'PageDown', control: true })).toBeNull()
    expect(kept({ key: 'PageDown', control: true, shift: true, alt: true })).toBeNull()
    expect(kept({ key: 'PageUp', control: true, shift: true, meta: true })).toBeNull()
    expect(kept({ key: 'PageDown', control: true, shift: true, repeat: true })).toBeNull()
    // As with Ctrl+Page Down, Control with these keys stays with the website or field on macOS.
    expect(kept({ key: 'PageDown', control: true, shift: true, mac: true })).toBeNull()
  })
})

// A website may keep Chrome's Downloads key, as a web editor does to show its own panel, so it is only the View menu's
// key, which reaches the menu when the page leaves it alone.
describe('the Downloads key', () => {
  it('is left to the page, Ctrl+J, or Cmd+Option+L on macOS, also with another script\'s layout on', () => {
    for (const key of [
      input({ key: 'j', code: 'KeyJ', control: true }), input({ key: 'о', code: 'KeyJ', control: true }),
      input({ key: '¬', code: 'KeyL', meta: true, alt: true, mac: true })
    ]) {
      expect(browserShortcutAction(key)).toBeNull()
      expect(websiteKeptShortcutAction(key)).toBeNull()
    }
  })
})

// Under a Hronaut dialog or the command palette, Hronaut's window keeps these from the application menu, which would
// act on the page behind it.
describe('the application menu\'s other keys', () => {
  const menuKey = (overrides: Partial<BrowserShortcutInput>) => applicationMenuKey(input(overrides))

  it('are Print, Save, View Page Source, Downloads, Back, Forward and Keyboard shortcuts elsewhere than macOS', () => {
    for (const key of [
      { key: 'p', code: 'KeyP', control: true }, { key: 's', code: 'KeyS', control: true }, { key: 'u', code: 'KeyU', control: true },
      { key: 'j', code: 'KeyJ', control: true }, { key: 'з', code: 'KeyP', control: true },
      { key: 'ArrowLeft', code: 'ArrowLeft', alt: true }, { key: 'ArrowRight', code: 'ArrowRight', alt: true },
      { key: '?', code: 'Slash', control: true, shift: true }, { key: '/', code: 'Slash', control: true, shift: true }
    ]) expect(menuKey(key), JSON.stringify(key)).toBe(true)
    for (const key of [
      { key: 'p', code: 'KeyP' }, { key: 'p', code: 'KeyP', control: true, alt: true }, { key: 'P', code: 'KeyP', control: true, shift: true },
      { key: 'p', code: 'KeyP', meta: true }, { key: 'c', code: 'KeyC', control: true }, { key: 'a', code: 'KeyA', control: true },
      { key: 'ArrowLeft', code: 'ArrowLeft' }, { key: 'ArrowLeft', code: 'ArrowLeft', control: true }, { key: 'ArrowLeft', code: 'ArrowLeft', alt: true, shift: true },
      { key: '/', code: 'Slash', control: true }, { key: 'p', code: 'KeyP', control: true, repeat: true }, { key: 'p', code: 'KeyP', control: true, composing: true }
    ]) expect(menuKey(key), JSON.stringify(key)).toBe(false)
  })

  it('are the same with Command on macOS, with Find Next and Find Previous', () => {
    for (const key of [
      { key: 'p', code: 'KeyP', meta: true }, { key: 's', code: 'KeyS', meta: true }, { key: 'g', code: 'KeyG', meta: true },
      { key: 'G', code: 'KeyG', meta: true, shift: true }, { key: '¨', code: 'KeyU', meta: true, alt: true }, { key: '¬', code: 'KeyL', meta: true, alt: true },
      { key: '[', code: 'BracketLeft', meta: true }, { key: ']', code: 'BracketRight', meta: true }, { key: '?', code: 'Slash', meta: true, shift: true },
      // Option+U is a dead key, and the bracket key types a Cyrillic letter with a Russian layout on.
      { key: 'Dead', code: 'KeyU', meta: true, alt: true }, { key: 'х', code: 'BracketLeft', meta: true }
    ]) expect(menuKey({ ...key, mac: true }), JSON.stringify(key)).toBe(true)
    for (const key of [
      { key: 'p', code: 'KeyP', control: true }, { key: 'p', code: 'KeyP', meta: true, control: true }, { key: 'u', code: 'KeyU', meta: true },
      { key: 'ArrowLeft', code: 'ArrowLeft', alt: true }, { key: 'c', code: 'KeyC', meta: true },
      // A Latin letter on the bracket key, as German ü, stays the letter.
      { key: 'ü', code: 'BracketLeft', meta: true }, { key: 'Dead', code: 'KeyE', meta: true, alt: true }
    ]) expect(menuKey({ ...key, mac: true }), JSON.stringify(key)).toBe(false)
  })

  it('are browser keys, with the shortcuts and the keys a website may keep, held or not', () => {
    for (const key of [
      { key: 'p', code: 'KeyP', control: true }, { key: 'r', code: 'KeyR', control: true, repeat: true }, { key: 'F5', repeat: true },
      { key: 'ArrowLeft', code: 'ArrowLeft', alt: true, repeat: true }
    ]) expect(isBrowserKey(input(key)), JSON.stringify(key)).toBe(true)
    for (const key of [{ key: 'c', code: 'KeyC', control: true }, { key: 'x', code: 'KeyX' }, { key: 'r', code: 'KeyR', control: true, composing: true }]) {
      expect(isBrowserKey(input(key)), JSON.stringify(key)).toBe(false)
    }
  })

  it('are no browser shortcuts, which Hronaut\'s window runs itself', () => {
    for (const key of [{ key: 'p', code: 'KeyP', control: true }, { key: 'ArrowLeft', code: 'ArrowLeft', alt: true }, { key: '?', code: 'Slash', control: true, shift: true }]) {
      expect(browserShortcutAction(input(key))).toBeNull()
      expect(websiteKeptShortcutAction(input(key))).toBeNull()
    }
  })
})
