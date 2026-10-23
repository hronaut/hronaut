import type { Input, WebContents } from 'electron'
import { browserShortcutAction, websiteKeptShortcutAction, type BrowserShortcutAction } from '../shared/browser-shortcuts.js'

export interface SidebarOverlayKeyboardHost {
  /** A key pressed or released in the view, which counts as held in the shell. */
  noteKey(input: Input): void
  /** Runs a browser shortcut pressed in the view, as the shell runs one pressed there, with the keyboard in the shell. */
  runShortcut(action: BrowserShortcutAction): void
}

/**
 * Keys pressed in the tab rail opened over the page, which is the shell's own rail drawn in a view of its own. A click
 * there can leave it the keyboard focus, as after one of its menus: a browser shortcut then works as in the shell,
 * rather than going nowhere, and a key held there, such as Delete closing a tab, does not repeat into the page that
 * gets the focus next. Escape and the rail's own keys stay with the view.
 */
export function attachSidebarOverlayKeyboard(contents: Pick<WebContents, 'on'>, host: SidebarOverlayKeyboardHost): void {
  contents.on('before-input-event', (event, input) => {
    host.noteKey(input)
    if (input.type !== 'keyDown') return
    const shortcut = {
      key: input.key,
      code: input.code,
      control: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift,
      repeat: input.isAutoRepeat,
      composing: input.isComposing,
      mac: process.platform === 'darwin'
    }
    // Hronaut's own rail has no website to keep F5, Alt+D, F3 or Ctrl+G, as in the shell.
    const action = browserShortcutAction(shortcut) ?? websiteKeptShortcutAction(shortcut)
    if (!action) return
    event.preventDefault()
    host.runShortcut(action)
  })
}
