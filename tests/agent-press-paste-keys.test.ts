import { expect, it } from 'vitest'
import { pastesClipboard } from '../src/main/browser/agent-keys/agent-keys.js'
import { parseBrowserKeyPress } from '../src/shared/keyboard-input.js'

// An agent's Control+V pasted the person's clipboard into its page, where the page and the agent could read it:
// Chromium runs its paste key bindings, and the Paste key, on the system clipboard.

const pasteKeys = ['Control+V', 'ctrl+v', 'Control+Shift+V', 'Shift+Control+v', 'Shift+Insert', 'shift+insert', 'Paste', 'paste', 'Control+Paste']

it.each(['linux', 'win32'] as const)('knows the paste keys on %s', (platform) => {
  for (const key of pasteKeys) expect(pastesClipboard(parseBrowserKeyPress(key), platform), key).toBe(true)
})

it('knows the paste keys Chromium has on macOS, where the app menu pastes with Command+V', () => {
  for (const key of ['Shift+Insert', 'Paste']) expect(pastesClipboard(parseBrowserKeyPress(key), 'darwin'), key).toBe(true)
  for (const key of ['Control+V', 'Control+Shift+V', 'Meta+V']) expect(pastesClipboard(parseBrowserKeyPress(key), 'darwin'), key).toBe(false)
})

it('leaves every other key alone, copy and cut keys included, as a web terminal\'s Control+C', () => {
  for (const key of ['v', 'V', 'Insert', 'Control+A', 'Control+C', 'Control+X', 'Control+Insert', 'Shift+Delete', 'Copy', 'Cut', 'Control+Alt+V',
    'Control+Meta+V', 'Meta+V', 'Control+KeyV', 'Shift+Control+Insert', 'Alt+Shift+Insert', 'Shift+F10']) {
    expect(pastesClipboard(parseBrowserKeyPress(key), 'linux'), key).toBe(false)
  }
})
