import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachPageKeyboardEvents } from '../src/main/browser/tab-events/page-keyboard-events.js'

// Ctrl+1 to Ctrl+9 were taken from every page elsewhere than macOS, where Chrome leaves them to a website first, such
// as a web editor going to its first editor group, and goes to that tab only when the page leaves the key alone.

const platform = process.platform
beforeEach(() => { Object.defineProperty(process, 'platform', { value: 'linux' }) })
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

type KeyInput = Partial<Electron.Input> & { key: string; code: string }

/** Sends a pressed key to a page as Electron does, and says whether a listener kept it from the page. */
function press(contents: EventEmitter, input: KeyInput): boolean {
  const event = { preventDefault: vi.fn() }
  const pressed = { type: 'keyDown', isAutoRepeat: false, isComposing: false, control: false, meta: false, alt: false, shift: false }
  contents.emit('before-input-event', event, { ...pressed, location: 0, modifiers: [], ...input })
  return event.preventDefault.mock.calls.length > 0
}

/** A page of a browser whose shortcuts go to the shell; the lock, trusted chrome and offered shortcuts can change. */
function pageWith(state: { locked?: boolean, occluded?: boolean, offered?: boolean } = {}) {
  const onShortcutRequested = vi.fn()
  const browser = {
    get browserContentOccluded() { return state.occluded === true },
    agentInputWebContents: new Map(),
    screenshotAreaSessions: new Map(),
    elementPickerSessions: new Map(),
    authorizedAgentKeyboardInput: new Map(),
    isHumanInteractionLocked: () => state.locked === true,
    shellHeldKeys: new Set<string>(),
    pageShortcutKey: null,
    tabs: new Map(),
    reproRecorder: { observeReproKeyboard: vi.fn() },
    mcpActivityFollower: { noteHumanInput: vi.fn() },
    options: { onShortcutRequested, onUserInteraction: vi.fn(), shortcutAvailable: () => state.offered !== false }
  }
  const contents = Object.assign(new EventEmitter(), { id: 1 })
  const tab = { id: 'tab-1', humanInteractionGeneration: 0, lastHumanInteractionAt: 0, lastActiveAt: 0 }
  attachPageKeyboardEvents(browser as never, tab as never, contents as never)
  return { contents, onShortcutRequested }
}

const ctrl = (digit: string): KeyInput => ({ key: digit, code: `Digit${digit}`, control: true })

describe('Ctrl with a digit in a page elsewhere than macOS', () => {
  it('reaches the page first, as in Chrome, so the menu goes to the tab only when the page leaves it alone', () => {
    const { contents, onShortcutRequested } = pageWith()
    for (const digit of ['1', '8', '9']) expect(press(contents, ctrl(digit)), digit).toBe(false)
    expect(onShortcutRequested).not.toHaveBeenCalled()
  })

  it('still goes to the tab from a page the person cannot use, which never sees the key', () => {
    for (const state of [{ locked: true }, { occluded: true }]) {
      const { contents, onShortcutRequested } = pageWith(state)
      expect(press(contents, ctrl('1'))).toBe(true)
      expect(press(contents, ctrl('9'))).toBe(true)
      expect(onShortcutRequested.mock.calls.map(([action]) => action)).toEqual(['select-tab-1', 'select-last-tab'])
    }
  })

  it('lets the other keys a website may keep act from such a page too, such as F5', () => {
    // A locked page took F5 from the menu as well, so it did not reload.
    for (const state of [{ locked: true }, { occluded: true }]) {
      const { contents, onShortcutRequested } = pageWith(state)
      expect(press(contents, { key: 'F5', code: 'F5' })).toBe(true)
      expect(onShortcutRequested.mock.calls.map(([action]) => action)).toEqual(['reload'])
    }
  })

  it('does nothing in a locked page when the shortcut is not offered', () => {
    const { contents, onShortcutRequested } = pageWith({ locked: true, offered: false })
    expect(press(contents, ctrl('1'))).toBe(true)
    expect(onShortcutRequested).not.toHaveBeenCalled()
  })

  it('leaves Cmd with a digit to the browser on macOS, which Chrome reserves there', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const { contents, onShortcutRequested } = pageWith()
    expect(press(contents, { key: '1', code: 'Digit1', meta: true })).toBe(true)
    expect(onShortcutRequested).toHaveBeenCalledExactlyOnceWith('select-tab-1', expect.anything())
  })
})
