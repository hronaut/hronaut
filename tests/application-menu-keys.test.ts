import { afterEach, describe, expect, it, vi } from 'vitest'
import { applicationMenuKey, browserShortcutAction, websiteKeptShortcutAction, type BrowserShortcutInput } from '../src/shared/browser-shortcuts.js'
type Item = { label?: string; accelerator?: string; submenu?: Item[] }
const installed = vi.hoisted(() => ({ template: [] as Item[] }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: Item[]) => template, setApplicationMenu: (menu: Item[]) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// Under a Hronaut dialog or the command palette, Hronaut's window leaves its keys alone, and a key it leaves alone
// reaches the application menu, which acts on the page behind it: Ctrl+R reloaded it and Alt+Left went back there.
// The window keeps every key of the menu there, so a key added to the menu must be one it knows.

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

const NAMED_KEYS: Readonly<Record<string, { key: string; code: string }>> = {
  Plus: { key: '=', code: 'Equal' }, '-': { key: '-', code: 'Minus' }, '/': { key: '?', code: 'Slash' },
  '[': { key: '[', code: 'BracketLeft' }, ']': { key: ']', code: 'BracketRight' },
  Left: { key: 'ArrowLeft', code: 'ArrowLeft' }, Right: { key: 'ArrowRight', code: 'ArrowRight' }
}

/** The key press an Electron accelerator stands for, as Hronaut's window sees it. */
function press(accelerator: string, mac: boolean): BrowserShortcutInput {
  const parts = accelerator.split('+')
  const name = parts.pop()!
  const modifiers = new Set(parts)
  const named = NAMED_KEYS[name]
  const key = named ?? (/^[A-Z]$/u.test(name) ? { key: name.toLowerCase(), code: `Key${name}` } : /^[0-9]$/u.test(name) ? { key: name, code: `Digit${name}` } : { key: name, code: name })
  return {
    ...key,
    control: modifiers.has('Ctrl') || (!mac && modifiers.has('CmdOrCtrl')),
    meta: modifiers.has('Cmd') || (mac && modifiers.has('CmdOrCtrl')),
    alt: modifiers.has('Alt'),
    shift: modifiers.has('Shift'),
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
        const input = press(accelerator, on === 'darwin')
        const known = (browserShortcutAction(input) ?? websiteKeptShortcutAction(input)) !== null || applicationMenuKey(input)
        expect(known, `${label} ${accelerator}`).toBe(true)
      }
    })
  }

  it('leave quitting to the menu under a dialog', () => {
    for (const on of ['linux', 'darwin'] as const) {
      const quit = accelerators(on).find((item) => item.label === 'native.menu.quit')!
      const input = press(quit.accelerator, on === 'darwin')
      expect(browserShortcutAction(input) ?? websiteKeptShortcutAction(input)).toBeNull()
      expect(applicationMenuKey(input)).toBe(false)
    }
  })
})
