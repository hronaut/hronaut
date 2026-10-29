import { afterEach, describe, expect, it, vi } from 'vitest'
import { isBrowserKey, type BrowserShortcutInput } from '../src/shared/browser-shortcuts.js'
type Item = { label?: string; accelerator?: string; submenu?: Item[] }
const installed = vi.hoisted(() => ({ template: [] as Item[] }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: Item[]) => template, setApplicationMenu: (menu: Item[]) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// Under a Hronaut dialog or the command palette, Hronaut's window leaves its keys alone, and a key it leaves alone
// reaches the application menu, which acts on the page behind it: Ctrl+R reloaded it and Ctrl+Plus zoomed it.
// The window keeps every key the menu sets there, so a key added to the menu must be one it knows. The Edit menu's
// and full screen's keys, and on macOS Hide's, Hide Others' and Minimize's, come from their roles, set no accelerator
// here, and stay with the menu.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function accelerators(on: NodeJS.Platform): Array<{ label: string; accelerator: string }> {
  Object.defineProperty(process, 'platform', { value: on })
  createApplicationMenu({
    text: (key) => key, showWindow: vi.fn(), mainWindow: () => null, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: vi.fn(), runShortcut: vi.fn(), runPageNextPane: vi.fn(), tabs: () => null
  }).installApplicationMenu()
  const found: Array<{ label: string; accelerator: string }> = []
  const walk = (items: Item[]) => {
    for (const item of items) {
      if (item.accelerator) found.push({ label: item.label ?? '', accelerator: item.accelerator })
      if (item.submenu) walk(item.submenu)
    }
  }
  walk(installed.template)
  return found
}

// Electron's Plus is the = key with Shift, as on a US keyboard.
const NAMED_KEYS: Readonly<Record<string, { key: string; code: string; shift?: true }>> = {
  Plus: { key: '+', code: 'Equal', shift: true }, '-': { key: '-', code: 'Minus' }, '/': { key: '/', code: 'Slash' },
  '[': { key: '[', code: 'BracketLeft' }, ']': { key: ']', code: 'BracketRight' },
  Left: { key: 'ArrowLeft', code: 'ArrowLeft' }, Right: { key: 'ArrowRight', code: 'ArrowRight' },
  PageUp: { key: 'PageUp', code: 'PageUp' }, PageDown: { key: 'PageDown', code: 'PageDown' }, Home: { key: 'Home', code: 'Home' },
  Escape: { key: 'Escape', code: 'Escape' }, ',': { key: ',', code: 'Comma' }
}
// On macOS Option changes the character a letter key types, as a US keyboard does: ç for C, ¬ for L, a dead key for U.
const MAC_OPTION_KEYS: Readonly<Record<string, string>> = { C: 'ç', L: '¬', U: 'Dead' }
const MODIFIERS = new Set(['CmdOrCtrl', 'Cmd', 'Ctrl', 'Alt', 'Shift'])

/** The key press an Electron accelerator stands for, as Hronaut's window sees it; a name it does not know fails. */
function press(accelerator: string, mac: boolean): BrowserShortcutInput {
  const parts = accelerator.split('+')
  const name = parts.pop()!
  const modifiers = new Set(parts)
  for (const modifier of modifiers) if (!MODIFIERS.has(modifier)) throw new Error(`Unknown modifier in ${accelerator}`)
  const alt = modifiers.has('Alt')
  let key: { key: string; code: string; shift?: true }
  if (NAMED_KEYS[name]) key = NAMED_KEYS[name]
  else if (/^[A-Z]$/u.test(name)) {
    const optionKey = mac && alt ? MAC_OPTION_KEYS[name] : name.toLowerCase()
    if (optionKey === undefined) throw new Error(`No Option character for ${accelerator}`)
    key = { key: optionKey, code: `Key${name}` }
  } else if (/^[0-9]$/u.test(name)) key = { key: name, code: `Digit${name}` }
  else if (/^F[0-9]{1,2}$/u.test(name)) key = { key: name, code: name }
  else throw new Error(`Unknown key in ${accelerator}`)
  const shift = modifiers.has('Shift') || key.shift === true
  return {
    key: shift && key.key === '/' ? '?' : key.key,
    code: key.code,
    control: modifiers.has('Ctrl') || (!mac && modifiers.has('CmdOrCtrl')),
    meta: modifiers.has('Cmd') || (mac && modifiers.has('CmdOrCtrl')),
    alt,
    shift,
    mac
  }
}

describe('the application menu\'s keys', () => {
  // Showing Hronaut's window and quitting act on no page, and quitting stays open to the person under a dialog.
  const windowKeys = new Set(['native.menu.show', 'native.menu.quit'])

  for (const on of ['linux', 'win32', 'darwin'] as const) {
    it(`are all keys Hronaut's window keeps under its dialogs on ${on}`, () => {
      const menuKeys = accelerators(on).filter((item) => !windowKeys.has(item.label))
      expect(menuKeys.length).toBeGreaterThan(10)
      for (const { label, accelerator } of menuKeys) {
        expect(isBrowserKey(press(accelerator, on === 'darwin')), `${label} ${accelerator}`).toBe(true)
      }
    })
  }

  // Elsewhere than macOS the menu goes by Chromium's code for the key in the layout, which a German keyboard gives its +
  // key for Zoom In's Ctrl+Shift+= and its # key for Keyboard shortcuts' Ctrl+Shift+/.
  it('are kept under a dialog when a layout types other characters with them', () => {
    const german = (key: string, code: string, keyCode: number, shift: boolean, alt = false): BrowserShortcutInput =>
      ({ key, code, keyCode, control: true, meta: false, alt, shift })
    expect(isBrowserKey(german('*', 'BracketRight', 187, true))).toBe(true)
    expect(isBrowserKey(german("'", 'Backslash', 191, true))).toBe(true)
    // A key of another code, or the same keys with other modifiers, stay with the dialog, as the menu leaves them alone:
    // Ctrl+# types nothing the menu knows, and AltGr, which Windows reports as Ctrl+Alt, types ~ with the + key.
    expect(isBrowserKey(german('Ü', 'BracketLeft', 186, true))).toBe(false)
    expect(isBrowserKey(german('ö', 'Semicolon', 192, false))).toBe(false)
    expect(isBrowserKey(german('#', 'Backslash', 191, false))).toBe(false)
    expect(isBrowserKey(german('~', 'BracketRight', 187, false, true))).toBe(false)
    // On macOS the menu goes by the character Cmd types, so the code changes nothing there.
    expect(isBrowserKey({ ...german('*', 'BracketRight', 187, true), control: false, meta: true, mac: true })).toBe(false)
  })

  // Hiding and minimizing act on Hronaut's window, not on a page, so they work under a dialog as quitting does.
  it('leave macOS\'s Hide, Hide Others and Minimize to the menu under a dialog', () => {
    for (const key of [{ key: 'h', code: 'KeyH' }, { key: '˙', code: 'KeyH', alt: true }, { key: 'm', code: 'KeyM' }]) {
      expect(isBrowserKey({ control: false, meta: true, alt: false, shift: false, mac: true, ...key }), JSON.stringify(key)).toBe(false)
    }
  })

  it('leave quitting to the menu under a dialog', () => {
    for (const on of ['linux', 'darwin'] as const) {
      const quit = accelerators(on).find((item) => item.label === 'native.menu.quit')!
      expect(isBrowserKey(press(quit.accelerator, on === 'darwin'))).toBe(false)
    }
  })
})
