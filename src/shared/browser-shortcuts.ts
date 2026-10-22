import { shortcutKey } from './shortcut-key.js'

export type BrowserShortcutAction =
  | 'focus-address'
  | 'new-tab'
  | 'close-tab'
  | 'reopen-closed-tab'
  | 'next-tab'
  | 'previous-tab'
  | `select-tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | 'select-last-tab'
  | 'find'
  | 'reload'
  | 'reload-ignoring-cache'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'bookmark'
  | 'visit-history'
  | 'search-tabs'
  | 'clear-browsing-data'
  | 'command-palette'
  | 'pick-element'
  | 'toggle-devtools'
  | 'agent-card'
  | 'toggle-full-page'
  | 'take-over'
  | 'switch-workspace'
  | `select-workspace-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | 'previous-workspace'

export interface BrowserShortcutInput {
  key: string
  /** The physical key, such as Digit1; workspace keys go by it so they work in every keyboard layout. */
  code?: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  repeat?: boolean
  composing?: boolean
  /** On macOS the workspace keys use Control, since Option with a digit types a character. */
  mac?: boolean
}

/**
 * Pinned workspaces 1 to 9, and the workspace used before this one, from the number row: Alt elsewhere, Control on
 * macOS. Ctrl/Cmd with a digit stays with the tabs, and Ctrl+Alt is AltGr on Windows, which types characters.
 */
function workspaceShortcut(input: BrowserShortcutInput): BrowserShortcutAction | null {
  const digit = /^Digit([0-9])$/u.exec(input.code ?? '')?.[1]
  if (!digit || input.shift || input.meta) return null
  if (input.mac ? !input.control || input.alt : input.control || !input.alt) return null
  return digit === '0' ? 'previous-workspace' : `select-workspace-${digit}` as BrowserShortcutAction
}

/**
 * Chrome's other keys for some of these actions. Elsewhere than macOS: F5 reloads, and Shift+F5 or Ctrl+F5 reloads
 * without the cache; Ctrl+Page Down and Ctrl+Page Up go to the next and previous tab; Alt+D goes to the address bar.
 * On macOS, where Option with D types a character, Cmd+Shift+] and Cmd+Shift+[ (by the keys' place on a US keyboard)
 * and Cmd+Option+Right and Cmd+Option+Left go to the next and previous tab.
 */
function chromeAlternateShortcut(input: BrowserShortcutInput, key: string): BrowserShortcutAction | null {
  if (input.mac) {
    if (!input.meta || input.control) return null
    if (input.shift && !input.alt && input.code === 'BracketRight') return 'next-tab'
    if (input.shift && !input.alt && input.code === 'BracketLeft') return 'previous-tab'
    if (input.alt && !input.shift && key === 'arrowright') return 'next-tab'
    if (input.alt && !input.shift && key === 'arrowleft') return 'previous-tab'
    return null
  }
  if (input.meta) return null
  if (key === 'f5' && !input.alt) {
    if (!input.control && !input.shift) return 'reload'
    if (input.control !== input.shift) return 'reload-ignoring-cache'
  }
  if (input.control && !input.alt && !input.shift && key === 'pagedown') return 'next-tab'
  if (input.control && !input.alt && !input.shift && key === 'pageup') return 'previous-tab'
  if (input.alt && !input.control && !input.shift && key === 'd') return 'focus-address'
  return null
}

export function browserShortcutAction(input: BrowserShortcutInput): BrowserShortcutAction | null {
  const key = shortcutKey(input)
  if (input.repeat || input.composing) return null
  if (
    (key === 'f12' && !input.control && !input.meta && !input.alt && !input.shift)
    || (key === 'i' && !input.mac && input.control && input.shift && !input.meta && !input.alt)
    || (key === 'i' && input.meta && input.alt && !input.control && !input.shift)
  ) return 'toggle-devtools'
  if (
    (key === 'c' && !input.mac && input.control && input.shift && !input.meta && !input.alt)
    || (key === 'c' && input.meta && input.alt && !input.control && !input.shift)
  ) return 'pick-element'
  const workspace = workspaceShortcut(input)
  if (workspace) return workspace
  const alternate = chromeAlternateShortcut(input, key)
  if (alternate) return alternate
  if (input.alt) return null

  if (input.control && key === 'tab') return input.shift ? 'previous-tab' : 'next-tab'
  // On macOS the browser keys use Command without Control, as in Chrome, and Developer Tools takes Command+Option
  // above. Control with a key belongs to the focused field or web app there: Control+F moves the caret, Control+D
  // deletes forward and Control+H backward, and a web terminal reads Control+W or Control+R itself.
  const primary = input.mac ? input.meta && !input.control : input.control || input.meta
  if (!input.shift && ((!input.mac && input.control && key === 'h') || (input.meta && key === 'y' && !(input.mac && input.control)))) return 'visit-history'
  if (!primary) return null
  if (!input.shift && /^[1-8]$/.test(key)) return `select-tab-${key}` as BrowserShortcutAction
  if (!input.shift && key === '9') return 'select-last-tab'
  if (input.shift && (key === 'delete' || key === 'backspace')) return 'clear-browsing-data'
  if (input.shift && key === 'p') return 'command-palette'
  if (input.shift && key === 'a') return 'search-tabs'
  if (key === 'r') return input.shift ? 'reload-ignoring-cache' : 'reload'

  if (key === '+' || key === '=') return 'zoom-in'
  if (!input.shift && key === '-') return 'zoom-out'
  if (!input.shift && key === '0') return 'zoom-reset'
  if (key === 't') return input.shift ? 'reopen-closed-tab' : 'new-tab'
  if (input.shift && key === 'f') return 'toggle-full-page'
  if (input.shift && key === 'o') return 'take-over'
  if (input.shift) return null
  if (key === 'l') return 'focus-address'
  if (key === 'w') return 'close-tab'
  if (key === 'f') return 'find'
  if (key === 'd') return 'bookmark'
  if (key === '.') return 'agent-card'
  if (key === 'k') return 'switch-workspace'
  return null
}
