import type { BrowserWindow } from 'electron'

/**
 * The physical keys held down in the shell. A shell control pressed with a key can hand the keyboard focus to a page,
 * such as Delete closing the active tab, and the held key's repeats then go to that page. A page that sees the key
 * pressed or released forgets it, and so does the window losing the focus, since the key's release then goes
 * elsewhere.
 */
export function trackShellHeldKeys(window: BrowserWindow): Set<string> {
  const held = new Set<string>()
  window.on('blur', () => held.clear())
  window.webContents.on('before-input-event', (_event, input) => {
    if (!input.code || input.isAutoRepeat) return
    if (input.type === 'keyUp') held.delete(input.code)
    else if (input.type === 'keyDown' || input.type === 'rawKeyDown') held.add(input.code)
  })
  return held
}
