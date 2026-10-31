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
    authorizedAgentKeyboardInput: new Map<number, unknown>(),
    isHumanInteractionLocked: () => state.locked === true,
    shellHeldKeys: new Set<string>(),
    pageShortcutKey: null as { code: string; webContentsId: number | null } | null,
    tabs: new Map(),
    reproRecorder: { observeReproKeyboard: vi.fn() },
    mcpActivityFollower: { noteHumanInput: vi.fn() },
    options: { onShortcutRequested, onUserInteraction: vi.fn(), shortcutAvailable: () => state.offered !== false }
  }
  let id = 0
  const page = () => {
    const contents = Object.assign(new EventEmitter(), { id: ++id })
    const tab = { id: `tab-${id}`, humanInteractionGeneration: 0, lastHumanInteractionAt: 0, lastActiveAt: 0 }
    attachPageKeyboardEvents(browser as never, tab as never, contents as never)
    return contents
  }
  return { contents: page(), page, browser, onShortcutRequested }
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

  it('lets the other keys a website may keep act from a locked page too, such as F5', () => {
    // A locked page took F5 from the menu as well, so it did not reload.
    const { contents, onShortcutRequested } = pageWith({ locked: true })
    expect(press(contents, { key: 'F5', code: 'F5' })).toBe(true)
    expect(press(contents, { key: 'F6', code: 'F6' })).toBe(true)
    expect(onShortcutRequested.mock.calls.map(([action]) => action)).toEqual(['reload', 'focus-next-pane'])
  })

  it('leaves the other keys a website may keep dead under a dialog of Hronaut\'s, as in its window', () => {
    const { contents, onShortcutRequested } = pageWith({ occluded: true })
    for (const pressed of [{ key: 'F5', code: 'F5' }, { key: 'PageDown', code: 'PageDown', control: true, shift: true }]) {
      expect(press(contents, pressed)).toBe(true)
    }
    expect(onShortcutRequested).not.toHaveBeenCalled()
  })

  it('goes with the numeric keypad\'s digits as well, as in Chrome', () => {
    const { contents, onShortcutRequested } = pageWith({ locked: true })
    expect(press(contents, { key: '2', code: 'Numpad2', control: true })).toBe(true)
    expect(onShortcutRequested.mock.calls.map(([action]) => action)).toEqual(['select-tab-2'])
  })

  it('held down, repeats into its own page only, not into the page of the tab it went to', () => {
    // Ctrl+2 left alone by the page went to the second tab, whose page then got each repeat as Ctrl+2, which a web
    // editor reads as going to its second editor group.
    const { contents, page, browser } = pageWith()
    const next = page()
    expect(press(contents, ctrl('2'))).toBe(false)
    expect(press(contents, { ...ctrl('2'), isAutoRepeat: true })).toBe(false)
    expect(press(next, { ...ctrl('2'), isAutoRepeat: true })).toBe(true)
    // Released, the key reaches every page again.
    press(next, { ...ctrl('2'), type: 'keyUp' })
    expect(browser.pageShortcutKey).toBeNull()
    expect(press(next, ctrl('2'))).toBe(false)
  })

  it('is not noted when an agent sends it, so the person\'s held key keeps repeating elsewhere', () => {
    const { contents, page, browser } = pageWith()
    const other = page()
    browser.authorizedAgentKeyboardInput.set(1, { type: 'keyDown', key: '2', code: 'Digit2', modifiers: 2, autoRepeat: false })
    expect(press(contents, { ...ctrl('2'), modifiers: ['control'] })).toBe(false)
    expect(browser.pageShortcutKey).toBeNull()
    expect(press(other, { key: 'a', code: 'KeyA', isAutoRepeat: true })).toBe(false)
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

describe('Control with Page Down in a page on macOS', () => {
  // Chrome goes to the next tab with Ctrl+Page Down there and keeps the key from websites; Ctrl+Shift+Page Down moves
  // the tab once the website leaves it alone. Both did nothing.
  it('goes to the next tab at once, and leaves Ctrl+Shift+Page Down to the page first', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const { contents, onShortcutRequested } = pageWith()
    expect(press(contents, { key: 'PageDown', code: 'PageDown', control: true })).toBe(true)
    expect(onShortcutRequested).toHaveBeenCalledExactlyOnceWith('next-tab', expect.anything())
    expect(press(contents, { key: 'PageDown', code: 'PageDown', control: true, shift: true })).toBe(false)
    expect(onShortcutRequested).toHaveBeenCalledOnce()
  })
})
