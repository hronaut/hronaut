import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { attachPageKeyboardEvents } from '../src/main/browser/tab-events/page-keyboard-events.js'

vi.mock('../src/main/browser/screenshot-area/screenshot-area.js', () => ({ cancelScreenshotArea: vi.fn(async () => undefined) }))
vi.mock('../src/main/browser/element-picker/element-picker.js', () => ({ cancelElementPicker: vi.fn(async () => undefined) }))

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

/** Pages of one browser, whose shortcuts go to the shell; the lock, trusted chrome and offered shortcuts can change. */
function browserWith(state: { locked?: boolean, occluded?: boolean, offered?: boolean } = {}) {
  const onShortcutRequested = vi.fn()
  const browser = {
    get browserContentOccluded() { return state.occluded === true },
    agentInputWebContents: new Map(),
    screenshotAreaSessions: new Map<number, { canceled: boolean }>(),
    elementPickerSessions: new Map<number, { canceled: boolean }>(),
    authorizedAgentKeyboardInput: new Map<number, unknown>(),
    isHumanInteractionLocked: () => state.locked === true,
    shellHeldKeys: new Set<string>(),
    pageShortcutKey: null,
    // The fake tabs are not open in it, so a released key schedules no overview preview.
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
  return { browser, page, onShortcutRequested }
}

const closeTab = { key: 'w', code: 'KeyW', control: !mac, meta: mac }
const zoomIn = { key: '=', code: 'Equal', control: !mac, meta: mac }
const held = { type: 'keyDown', isAutoRepeat: true } as const

describe('the key of a browser shortcut taken from a page', () => {
  it('does not repeat into the page of the tab shown next', () => {
    const { page, onShortcutRequested } = browserWith()
    const first = page()
    expect(press(first, { type: 'keyDown', ...closeTab })).toBe(true)
    expect(onShortcutRequested).toHaveBeenCalledExactlyOnceWith('close-tab', expect.anything())
    const next = page()
    expect(press(next, { ...held, ...closeTab })).toBe(true)
    expect(press(next, { ...held, ...closeTab })).toBe(true)
    expect(onShortcutRequested).toHaveBeenCalledOnce()
    // Released, the key reaches pages again, and other keys repeat into them.
    press(next, { type: 'keyUp', ...closeTab })
    expect(press(next, { type: 'keyDown', key: 'a', code: 'KeyA' })).toBe(false)
    expect(press(next, { ...held, key: 'a', code: 'KeyA' })).toBe(false)
  })

  it('repeats into its own page, where the View menu goes on zooming it while Ctrl+= is held', () => {
    const { page, onShortcutRequested } = browserWith()
    const shown = page()
    expect(press(shown, { type: 'keyDown', ...zoomIn })).toBe(true)
    expect(onShortcutRequested).toHaveBeenCalledExactlyOnceWith('zoom-in', expect.anything())
    expect(press(shown, { ...held, ...zoomIn })).toBe(false)
    expect(press(page(), { ...held, ...zoomIn })).toBe(true)
  })

  it('does not repeat into its own page for any other shortcut, such as Ctrl+W before the tab closes', () => {
    // A held Ctrl+Shift+F reached the View menu's Full Page View on each repeat, turning it on and off.
    const fullPage = { key: 'F', code: 'KeyF', control: !mac, meta: mac, shift: true }
    for (const shortcut of [closeTab, fullPage]) {
      const { page, onShortcutRequested } = browserWith()
      const shown = page()
      expect(press(shown, { type: 'keyDown', ...shortcut })).toBe(true)
      expect(onShortcutRequested).toHaveBeenCalledOnce()
      expect(press(shown, { ...held, ...shortcut })).toBe(true)
    }
  })

  it('does not repeat into the next page when the human input lock or trusted chrome took it either', () => {
    for (const state of [{ locked: true }, { occluded: true }]) {
      const { page, onShortcutRequested } = browserWith(state)
      expect(press(page(), { type: 'keyDown', ...closeTab })).toBe(true)
      expect(onShortcutRequested).toHaveBeenCalledOnce()
      Object.assign(state, { locked: false, occluded: false })
      expect(press(page(), { ...held, ...closeTab })).toBe(true)
    }
  })

  it('is not noted when an agent sends it, so a key the person holds in another page keeps repeating', () => {
    const { browser, page, onShortcutRequested } = browserWith()
    const shown = page()
    const agents = page()
    browser.authorizedAgentKeyboardInput.set(2, { type: 'keyDown', key: 'w', code: 'KeyW', modifiers: mac ? 4 : 2, autoRepeat: false })
    expect(press(agents, { type: 'keyDown', ...closeTab, modifiers: [mac ? 'meta' : 'control'] })).toBe(true)
    expect(onShortcutRequested).toHaveBeenCalledOnce()
    expect(press(shown, { ...held, key: 'w', code: 'KeyW' })).toBe(false)
  })

  it('leaves a key the page keeps to the page, with its repeats', () => {
    // Ctrl+B, an editor's Bold, and Ctrl+. while there is no agent card to open, an editor's quick fix.
    const { browser, page, onShortcutRequested } = browserWith({ offered: false })
    const shown = page()
    const next = page()
    for (const kept of [{ key: 'b', code: 'KeyB' }, { key: '.', code: 'Period' }]) {
      expect(press(shown, { type: 'keyDown', ...kept, control: !mac, meta: mac })).toBe(false)
      expect(press(next, { ...held, ...kept, control: !mac, meta: mac })).toBe(false)
    }
    expect(browser.pageShortcutKey).toBeNull()
    expect(onShortcutRequested).not.toHaveBeenCalled()
  })
})

describe('Escape that ends the screenshot area or the element picker', () => {
  it('does not repeat into the page once it is gone, until Escape is released', () => {
    for (const sessions of ['screenshotAreaSessions', 'elementPickerSessions'] as const) {
      const { browser, page } = browserWith()
      const shown = page()
      const session = { canceled: false }
      browser[sessions].set(1, session)
      expect(press(shown, { type: 'keyDown', key: 'Escape', code: 'Escape' })).toBe(true)
      session.canceled = true
      expect(press(shown, { ...held, key: 'Escape', code: 'Escape' })).toBe(true)
      press(shown, { type: 'keyUp', key: 'Escape', code: 'Escape' })
      expect(press(shown, { type: 'keyDown', key: 'Escape', code: 'Escape' })).toBe(false)
      expect(press(shown, { ...held, key: 'Escape', code: 'Escape' })).toBe(false)
    }
  })
})
