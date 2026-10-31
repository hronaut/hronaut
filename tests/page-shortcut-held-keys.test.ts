import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { attachPageKeyboardEvents } from '../src/main/browser/tab-events/page-keyboard-events.js'

// A browser shortcut pressed in a page, such as Ctrl+W, was taken from the page, but its key was not noted as held:
// held down, its repeats went on to the page of the tab shown next as Ctrl+W, which a web IDE may read as closing an editor.

type KeyInput = Partial<Electron.Input> & { type: Electron.Input['type'] }

const mac = process.platform === 'darwin'

function key(input: KeyInput): Electron.Input {
  const pressed = { key: '', code: '', isAutoRepeat: false, isComposing: false, control: false, meta: false, alt: false, shift: false }
  return { ...pressed, location: 0, modifiers: [], ...input } as Electron.Input
}

/** Sends a key to a page as Electron does, and says whether a listener kept it from the page. */
function press(contents: EventEmitter, input: KeyInput): boolean {
  const event = { preventDefault: vi.fn() }
  contents.emit('before-input-event', event, key(input))
  return event.preventDefault.mock.calls.length > 0
}

/** Pages of one browser, whose shortcuts go to the shell. */
function browserWith(options: { locked?: boolean, occluded?: boolean, offered?: boolean } = {}) {
  const onShortcutRequested = vi.fn()
  const browser = {
    browserContentOccluded: options.occluded === true,
    agentInputWebContents: new Map(),
    screenshotAreaSessions: new Map(),
    elementPickerSessions: new Map(),
    authorizedAgentKeyboardInput: new Map(),
    isHumanInteractionLocked: () => options.locked === true,
    shellHeldKeys: new Set<string>(),
    // The fake tabs are not open in it, so a released key schedules no overview preview.
    tabs: new Map(),
    reproRecorder: { observeReproKeyboard: vi.fn() },
    mcpActivityFollower: { noteHumanInput: vi.fn() },
    options: { onShortcutRequested, onUserInteraction: vi.fn(), shortcutAvailable: () => options.offered !== false }
  }
  let id = 0
  const page = () => {
    const contents = Object.assign(new EventEmitter(), { id: ++id })
    const tab = { id: `tab-${id}`, humanInteractionGeneration: 0, lastHumanInteractionAt: 0, lastActiveAt: 0 }
    attachPageKeyboardEvents(browser as never, tab as never, contents as never)
    return contents
  }
  return { browser, page, onShortcutRequested }
}

const closeTab = { key: 'w', code: 'KeyW', control: !mac, meta: mac }

describe('the key of a browser shortcut taken from a page', () => {
  it('does not repeat into the page of the tab shown next, or into its own page, while it is held', () => {
    const { page, onShortcutRequested } = browserWith()
    const first = page()
    expect(press(first, { type: 'keyDown', ...closeTab })).toBe(true)
    expect(onShortcutRequested).toHaveBeenCalledExactlyOnceWith('close-tab', expect.anything())
    const next = page()
    expect(press(next, { type: 'keyDown', ...closeTab, isAutoRepeat: true })).toBe(true)
    expect(press(next, { type: 'keyDown', ...closeTab, isAutoRepeat: true })).toBe(true)
    expect(press(first, { type: 'keyDown', ...closeTab, isAutoRepeat: true })).toBe(true)
    expect(onShortcutRequested).toHaveBeenCalledOnce()
    // Released, the key reaches pages again, and other keys repeat into them.
    press(next, { type: 'keyUp', ...closeTab })
    expect(press(next, { type: 'keyDown', key: 'a', code: 'KeyA' })).toBe(false)
    expect(press(next, { type: 'keyDown', key: 'a', code: 'KeyA', isAutoRepeat: true })).toBe(false)
  })

  it('does not repeat into a page while the human input lock or trusted chrome took it either', () => {
    for (const options of [{ locked: true }, { occluded: true }]) {
      const { browser, page } = browserWith(options)
      expect(press(page(), { type: 'keyDown', ...closeTab })).toBe(true)
      expect([...browser.shellHeldKeys]).toEqual(['KeyW'])
    }
  })

  it('leaves a key the page keeps to the page, with its repeats', () => {
    // Ctrl+B, an editor's Bold, and Ctrl+. while there is no agent card to open, an editor's quick fix.
    const { browser, page, onShortcutRequested } = browserWith({ offered: false })
    const shown = page()
    for (const kept of [{ key: 'b', code: 'KeyB' }, { key: '.', code: 'Period' }]) {
      expect(press(shown, { type: 'keyDown', ...kept, control: !mac, meta: mac })).toBe(false)
      expect(press(shown, { type: 'keyDown', ...kept, control: !mac, meta: mac, isAutoRepeat: true })).toBe(false)
    }
    expect(browser.shellHeldKeys.size).toBe(0)
    expect(onShortcutRequested).not.toHaveBeenCalled()
  })
})
