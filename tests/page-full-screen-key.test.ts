import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachPageKeyboardEvents } from '../src/main/browser/tab-events/page-keyboard-events.js'

// A page that kept F11 held the person in full screen: the key never reached the View menu, so it could not leave by
// the key it came in with. Chrome makes the key the browser's while the window is in full screen.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

type KeyInput = Partial<Electron.Input> & { key: string; code: string }

/** Sends a key to a page as Electron does, and says whether a listener kept it from the page. */
function press(contents: EventEmitter, input: KeyInput): boolean {
  const event = { preventDefault: vi.fn() }
  const pressed = { type: 'keyDown', isAutoRepeat: false, isComposing: false, control: false, meta: false, alt: false, shift: false }
  contents.emit('before-input-event', event, { ...pressed, location: 0, modifiers: [], ...input })
  return event.preventDefault.mock.calls.length > 0
}

/** A page of a browser whose window may be in full screen, whose page may be locked and whose pages may be covered. */
function pageWith(state: { fullScreen: boolean, locked?: boolean, occluded?: boolean, platform?: NodeJS.Platform }) {
  Object.defineProperty(process, 'platform', { value: state.platform ?? 'linux' })
  const window = {
    isFullScreen: () => state.fullScreen,
    setFullScreen: vi.fn((value: boolean) => { state.fullScreen = value })
  }
  const browser = {
    window,
    browserContentOccluded: state.occluded === true,
    agentInputWebContents: new Map(),
    screenshotAreaSessions: new Map(),
    elementPickerSessions: new Map(),
    authorizedAgentKeyboardInput: new Map<number, unknown>(),
    isHumanInteractionLocked: () => state.locked === true,
    shellHeldKeys: new Set<string>(),
    pageShortcutKey: null,
    tabs: new Map(),
    reproRecorder: { observeReproKeyboard: vi.fn() },
    mcpActivityFollower: { noteHumanInput: vi.fn() },
    options: { onShortcutRequested: vi.fn(), onUserInteraction: vi.fn(), shortcutAvailable: () => true }
  }
  const contents = Object.assign(new EventEmitter(), { id: 1 })
  const tab = { id: 'tab-1', humanInteractionGeneration: 0, lastHumanInteractionAt: 0, lastActiveAt: 0 }
  attachPageKeyboardEvents(browser as never, tab as never, contents as never)
  return { contents, window, browser }
}

const f11: KeyInput = { key: 'F11', code: 'F11' }

describe('the full screen key in a page', () => {
  it('leaves full screen from a page that would keep the key', () => {
    const { contents, window, browser } = pageWith({ fullScreen: true })
    expect(press(contents, f11)).toBe(true)
    expect(window.setFullScreen.mock.calls).toEqual([[false]])
    // A person's key, as any other: it hides a shell tooltip.
    expect(browser.options.onUserInteraction).toHaveBeenCalledOnce()
    // Its repeats toggle nothing, and stay out of the page.
    expect(press(contents, { ...f11, isAutoRepeat: true })).toBe(true)
    expect(window.setFullScreen).toHaveBeenCalledOnce()
  })

  it('reaches the page first out of full screen, as in Chrome, so the View menu enters it when the page leaves the key alone', () => {
    const { contents, window } = pageWith({ fullScreen: false })
    expect(press(contents, f11)).toBe(false)
    expect(press(contents, { ...f11, shift: true })).toBe(false)
    expect(window.setFullScreen).not.toHaveBeenCalled()
  })

  it('enters and leaves full screen from a locked page, which keeps no key from the menu', () => {
    const { contents, window } = pageWith({ fullScreen: false, locked: true })
    expect(press(contents, f11)).toBe(true)
    expect(press(contents, f11)).toBe(true)
    expect(window.setFullScreen.mock.calls).toEqual([[true], [false]])
  })

  it('uses Control+Command+F on macOS, where F11 is the page\'s', () => {
    const { contents, window } = pageWith({ fullScreen: true, platform: 'darwin' })
    expect(press(contents, f11)).toBe(false)
    expect(press(contents, { key: 'f', code: 'KeyF', control: true, meta: true })).toBe(true)
    expect(window.setFullScreen.mock.calls).toEqual([[false]])
  })

  it('goes on macOS by the key that types F, as the View menu does, or by the F key\'s place with a layout of another script', () => {
    const { contents, window } = pageWith({ fullScreen: true, platform: 'darwin' })
    // Dvorak's U sits where a US keyboard has F, and its F where a US keyboard has Y.
    expect(press(contents, { key: 'u', code: 'KeyF', control: true, meta: true })).toBe(false)
    expect(window.setFullScreen).not.toHaveBeenCalled()
    expect(press(contents, { key: 'f', code: 'KeyY', control: true, meta: true })).toBe(true)
    expect(window.setFullScreen.mock.calls).toEqual([[false]])
    // The Russian layout's Cyrillic a sits on the F key.
    const russian = pageWith({ fullScreen: true, platform: 'darwin' })
    expect(press(russian.contents, { key: '\u0430', code: 'KeyF', control: true, meta: true })).toBe(true)
    expect(russian.window.setFullScreen.mock.calls).toEqual([[false]])
  })

  it('leaves the full screen key an agent sends with the page', () => {
    const { contents, window, browser } = pageWith({ fullScreen: true })
    browser.authorizedAgentKeyboardInput.set(1, { type: 'keyDown', key: 'F11', code: 'F11', modifiers: 0, autoRepeat: false })
    expect(press(contents, f11)).toBe(false)
    expect(browser.authorizedAgentKeyboardInput.has(1)).toBe(false)
    expect(window.setFullScreen).not.toHaveBeenCalled()
  })

  it('enters and leaves full screen while trusted chrome covers the pages, as the shell under its dialogs does', () => {
    const { contents, window } = pageWith({ fullScreen: false, occluded: true })
    expect(press(contents, f11)).toBe(true)
    expect(press(contents, { ...f11, isAutoRepeat: true })).toBe(true)
    expect(press(contents, f11)).toBe(true)
    expect(window.setFullScreen.mock.calls).toEqual([[true], [false]])
  })
})
