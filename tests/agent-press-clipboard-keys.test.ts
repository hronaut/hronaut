import { expect, it } from 'vitest'
import { usesClipboard } from '../src/main/browser/agent-keys/agent-keys.js'
import { parseBrowserKeyPress } from '../src/shared/keyboard-input.js'

// An agent's Control+V pasted the person's clipboard into its page, where the page and the agent could read it, and its
// Control+C replaced what they had copied: Chromium runs its copy, cut and paste key bindings on the system clipboard.

const clipboardKeys = ['Control+C', 'Control+X', 'Control+V', 'ctrl+v', 'Control+Shift+V', 'Shift+Control+v', 'Control+Insert', 'Shift+Insert', 'Shift+Delete']

it.each(['linux', 'win32'] as const)('knows the copy, cut and paste keys on %s', (platform) => {
  for (const key of clipboardKeys) expect(usesClipboard(parseBrowserKeyPress(key), platform), key).toBe(true)
})

it('leaves every other key alone, as Chromium copies, cuts and pastes on no other', () => {
  for (const key of ['v', 'V', 'Control+A', 'Control+Z', 'Control+Alt+V', 'Control+Meta+V', 'Meta+V', 'Control+Shift+C', 'Control+Shift+X',
    'Control+KeyV', 'Insert', 'Delete', 'Control+Delete', 'Shift+Control+Insert', 'Alt+Shift+Insert', 'Shift+F10']) {
    expect(usesClipboard(parseBrowserKeyPress(key), 'linux'), key).toBe(false)
  }
})

it('leaves macOS alone, where the app menu, not the page, copies and pastes', () => {
  for (const key of [...clipboardKeys, 'Meta+V', 'Meta+C']) expect(usesClipboard(parseBrowserKeyPress(key), 'darwin'), key).toBe(false)
})
