import { shortcutKey } from './shortcut-key.js'

export type BrowserShortcutAction =
  | 'focus-address'
  | 'focus-next-pane'
  | 'new-tab'
  | 'close-tab'
  | 'reopen-closed-tab'
  | 'next-tab'
  | 'previous-tab'
  | 'move-tab-next'
  | 'move-tab-previous'
  | `select-tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | 'select-last-tab'
  | 'find'
  | 'find-next'
  | 'find-previous'
  | 'reload'
  | 'reload-ignoring-cache'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'bookmark'
  | 'visit-history'
  | 'downloads'
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
 * Chrome's other keys for changing tabs, which Chrome keeps from websites as it keeps Ctrl+Tab: Ctrl+Page Down and
 * Ctrl+Page Up elsewhere than macOS; on macOS, Cmd+Shift+] and Cmd+Shift+[ and Cmd+Option+Right and Cmd+Option+Left.
 */
function chromeTabShortcut(input: BrowserShortcutInput, key: string): BrowserShortcutAction | null {
  if (input.mac) {
    if (!input.meta || input.control) return null
    // By the character, so a layout whose bracket key types a letter, such as German ü, gains no tab key.
    if (input.shift && !input.alt && (input.key === '}' || input.key === ']')) return 'next-tab'
    if (input.shift && !input.alt && (input.key === '{' || input.key === '[')) return 'previous-tab'
    if (input.alt && !input.shift && key === 'arrowright') return 'next-tab'
    if (input.alt && !input.shift && key === 'arrowleft') return 'previous-tab'
    return null
  }
  if (!input.control || input.meta || input.alt || input.shift) return null
  return key === 'pagedown' ? 'next-tab' : key === 'pageup' ? 'previous-tab' : null
}

/**
 * Chrome's keys a website may keep, elsewhere than macOS: F5 reloads, Shift+F5 or Ctrl+F5 reloads without the cache,
 * Alt+D goes to the address bar, F3 or Ctrl+G finds the next match, with Shift the previous one, Ctrl+Shift+Page Down
 * and Ctrl+Shift+Page Up move the tab, and F6 or Shift+F6 goes to the next pane: from a page to the address bar, and
 * from Hronaut's window back to the page. A website's own keys come first there, as in Chrome, where a web editor runs F5
 * as its debugger, Ctrl+G to go to a line and Ctrl+Shift+Page Down to move its own editor tab, and a web terminal reads
 * Alt+D, so they act only when the page in focus leaves them alone, and in Hronaut's own window as the
 * browser's keys at once. On macOS, Cmd+G and Cmd+Shift+G reach the Edit menu's Find Next and Find Previous.
 */
export function websiteKeptShortcutAction(input: BrowserShortcutInput): BrowserShortcutAction | null {
  if (input.mac || input.meta || input.repeat || input.composing) return null
  const key = shortcutKey(input)
  if (key === 'f5' && !input.alt) {
    if (!input.control && !input.shift) return 'reload'
    if (input.control !== input.shift) return 'reload-ignoring-cache'
  }
  if (key === 'd' && input.alt && !input.control && !input.shift) return 'focus-address'
  if (key === 'f6' && !input.alt && !input.control) return 'focus-next-pane'
  if (!input.alt && ((key === 'f3' && !input.control) || (key === 'g' && input.control))) return input.shift ? 'find-previous' : 'find-next'
  if (input.control && input.shift && !input.alt) {
    if (key === 'pagedown') return 'move-tab-next'
    if (key === 'pageup') return 'move-tab-previous'
  }
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
  const tab = chromeTabShortcut(input, key)
  if (tab) return tab
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
