import type { BrowserWindow, Input } from 'electron'

/**
 * The physical keys held down in the shell. A shell control pressed with a key can hand the keyboard focus to a page,
 * such as Delete closing the active tab, and the held key's repeats then go to that page. A page that sees a key
 * pressed or released forgets them, and so does the window losing the focus, since a key's release then goes
 * elsewhere.
 */
export function trackShellHeldKeys(window: BrowserWindow): Set<string> {
  const held = new Set<string>()
  window.on('blur', () => held.clear())
  window.webContents.on('before-input-event', (_event, input) => noteShellHeldKey(held, input))
  return held
}

/**
 * Notes a key pressed or released in the shell, or in another view of the shell's own, such as the tab rail opened
 * over the page, whose controls hand the focus on as the shell's do.
 */
export function noteShellHeldKey(held: Set<string>, input: Pick<Input, 'code' | 'isAutoRepeat' | 'type'>): void {
  if (!input.code || input.isAutoRepeat) return
  if (input.type === 'keyUp') held.delete(input.code)
  else if (input.type === 'keyDown' || input.type === 'rawKeyDown') held.add(input.code)
}
