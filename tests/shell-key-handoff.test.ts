import { EventEmitter } from 'node:events'
import type { IpcMainEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserShortcutAction } from '../src/shared/browser-shortcuts.js'

// Keys typed right after Ctrl/Cmd+L from a page, while Hronaut's window was busy, reached the window before the
// shortcut did: they went after the address's text, which the address field then selected along with them. Chrome
// runs its keys in order.

type MenuItem = { label?: string; click?: (item: unknown, window: unknown, event: Partial<Electron.KeyboardEvent>) => void; submenu?: MenuItem[] }
const installed = vi.hoisted(() => ({ template: [] as MenuItem[] }))
vi.mock('electron', () => ({
  session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, powerMonitor: { on: () => undefined },
  app: { getPath: () => '/tmp', on: () => undefined },
  Menu: { buildFromTemplate: (template: MenuItem[]) => template, setApplicationMenu: (menu: MenuItem[]) => { installed.template = menu } }
}))

const { attachShellKeyHandoff, keyEventsOf, requestShellShortcut, shellRanShortcut } = await import('../src/main/windows/shell-key-handoff.js')
const { createBrowserShortcutRouting } = await import('../src/main/browser-shortcut-routing.js')
const { createApplicationMenu } = await import('../src/main/windows/application-menu.js')
const { registerShellIpc } = await import('../src/main/shell-ipc.js')

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function key(input: Partial<Electron.Input> = {}): Electron.Input {
  return {
    type: 'keyDown', key: 'a', code: 'KeyA', isAutoRepeat: false, isComposing: false, shift: false, control: false,
    alt: false, meta: false, location: 0, modifiers: [], ...input
  } as Electron.Input
}

/** The main window's shell, with the handoff main attaches when it opens it. */
function shell() {
  let destroyed = false
  /** The key downs and releases sent to the shell, each with whether it stopped there, as Electron hands them on. */
  const sentKeys: Array<{ type: string; keyCode: string; stopped: boolean }> = []
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => destroyed,
    focus: vi.fn(),
    send: vi.fn(),
    sendInputEvent: vi.fn((event: Electron.KeyboardInputEvent) => {
      if (event.type === 'char') return
      let stopped = false
      const inputEvent = { preventDefault: () => { stopped = true }, get defaultPrevented() { return stopped } }
      contents.emit('before-input-event', inputEvent, key({ type: event.type as 'keyDown', key: event.keyCode, code: '' }))
      sentKeys.push({ type: event.type, keyCode: event.keyCode, stopped })
    })
  })
  attachShellKeyHandoff(contents as never)
  /** Types a key as the keyboard does, and says whether the shell held it back. */
  const type = (input: Partial<Electron.Input> = {}) => {
    let prevented = false
    const event = { preventDefault: () => { prevented = true }, get defaultPrevented() { return prevented } }
    contents.emit('before-input-event', event, key(input))
    return prevented
  }
  /** Asks the shell to run the shortcut, and gives the hold it was sent with, if any. */
  const request = (action: BrowserShortcutAction) => {
    requestShellShortcut(contents as never, action)
    return contents.send.mock.calls.at(-1)?.[2] as number | undefined
  }
  const ran = (hold: number | undefined) => shellRanShortcut(contents as never, hold!)
  /** The text the keys sent on typed, as the shell's field takes them. */
  const typed = () => contents.sendInputEvent.mock.calls.map(([event]) => event as Electron.KeyboardInputEvent)
    .filter((event) => event.type === 'char').map((event) => event.keyCode).join('')
  return { contents, type, request, ran, typed, sentKeys, destroy: () => { destroyed = true } }
}

describe('the keys typed while Hronaut\'s window runs a shortcut', () => {
  it('wait for it, then go on in the order they were typed', () => {
    const { contents, type, request, ran } = shell()
    const hold = request('focus-address')
    expect(contents.send).toHaveBeenCalledExactlyOnceWith('browser:shortcut-requested', 'focus-address', hold)
    expect([type({ key: 'h', code: 'KeyH' }), type({ key: 'I', code: 'KeyI', shift: true })]).toEqual([true, true])
    expect(contents.sendInputEvent).not.toHaveBeenCalled()
    ran(hold)
    expect(contents.sendInputEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: 'keyDown', keyCode: 'h', modifiers: [] },
      { type: 'char', keyCode: 'h', modifiers: [] },
      { type: 'keyUp', keyCode: 'h', modifiers: [] },
      { type: 'keyDown', keyCode: 'I', modifiers: ['shift'] },
      { type: 'char', keyCode: 'I', modifiers: ['shift'] },
      { type: 'keyUp', keyCode: 'I', modifiers: ['shift'] },
      { type: 'keyDown', keyCode: 'F24' }
    ])
    // Once it has run, keys go to the window as they come, including the ones sent on.
    expect(type({ key: 'h', code: 'KeyH' })).toBe(false)
  })

  it('end with a key down that stops in main, so a held key\'s own text arriving late is dropped as Chromium drops it', () => {
    // A held key down makes Chromium drop the key's text and release until the next key down, and a key sent on is one.
    // On Windows a key's text comes a moment after its key down, so it could otherwise type the key twice.
    const { type, request, ran, sentKeys } = shell()
    const hold = request('focus-address')
    type({ key: 'o', code: 'KeyO' })
    type({ key: 'k', code: 'KeyK' })
    ran(hold)
    expect(sentKeys).toEqual([
      { type: 'keyDown', keyCode: 'o', stopped: false }, { type: 'keyUp', keyCode: 'o', stopped: false },
      { type: 'keyDown', keyCode: 'k', stopped: false }, { type: 'keyUp', keyCode: 'k', stopped: false },
      { type: 'keyDown', keyCode: 'F24', stopped: true }
    ])
    // The next key typed goes on as it comes.
    expect(type({ key: 'k', code: 'KeyK' })).toBe(false)
  })

  it('end without it when the last key down went on, so that its release still reaches the window', () => {
    const { type, request, ran, sentKeys, typed } = shell()
    const hold = request('focus-address')
    type({ key: 'o', code: 'KeyO' })
    expect(type({ key: 'Shift', code: 'ShiftLeft', shift: true })).toBe(false)
    ran(hold)
    expect(typed()).toBe('o')
    expect(sentKeys.map((sent) => sent.keyCode)).toEqual(['o', 'o'])
    // With no key held, nothing is sent.
    ran(request('find'))
    expect(sentKeys).toHaveLength(2)
  })

  it('are held only for the shortcuts that give a field or a dialog the keyboard', () => {
    const { contents, type, request } = shell()
    for (const action of ['reload', 'new-tab', 'zoom-in', 'pick-element'] as const) {
      expect(request(action)).toBeUndefined()
      expect(contents.send).toHaveBeenLastCalledWith('browser:shortcut-requested', action)
      expect(type()).toBe(false)
    }
    // History puts the keyboard in its search.
    const holds = (['focus-address', 'find', 'find-next', 'find-previous', 'bookmark-all-tabs', 'command-palette', 'visit-history'] as const)
      .map(request)
    expect(new Set(holds).size).toBe(7)
    expect(holds.every((hold) => typeof hold === 'number')).toBe(true)
    for (const hold of holds) shellRanShortcut(contents as never, hold!)
  })

  it('go to the window at once when it runs no shortcut, and an answer for no hold changes nothing', () => {
    const { contents, type, ran } = shell()
    expect(type()).toBe(false)
    ran(12345)
    expect(contents.sendInputEvent).not.toHaveBeenCalled()
  })

  it('wait for every shortcut sent meanwhile, as Ctrl+L pressed twice, and its answer only', () => {
    const { type, request, ran, typed } = shell()
    const first = request('focus-address')
    const second = request('focus-address')
    type({ key: 'x', code: 'KeyX' })
    ran(first)
    // The window can answer one shortcut twice, as with two listeners; the other still waits.
    ran(first)
    expect(typed()).toBe('')
    ran(second)
    expect(typed()).toBe('x')
  })

  it('go on after a second should the window not answer, as while it reloads', () => {
    vi.useFakeTimers()
    const { contents, type, request, ran, typed } = shell()
    const hold = request('focus-address')
    vi.advanceTimersByTime(400)
    type({ key: 'q', code: 'KeyQ' })
    vi.advanceTimersByTime(599)
    expect(contents.sendInputEvent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(typed()).toBe('q')
    // Its late answer holds back nothing more.
    ran(hold)
    expect(type()).toBe(false)
  })

  it('wait a second from the last shortcut sent', () => {
    vi.useFakeTimers()
    const { contents, type, request, typed } = shell()
    request('focus-address')
    type({ key: 'q', code: 'KeyQ' })
    vi.advanceTimersByTime(900)
    request('find')
    vi.advanceTimersByTime(999)
    expect(contents.sendInputEvent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(typed()).toBe('q')
  })

  it('are not held once a second has gone by with none typed, and start no timer until one is', () => {
    vi.useFakeTimers()
    const { contents, type, request } = shell()
    request('focus-address')
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(type()).toBe(false)
    expect(contents.sendInputEvent).not.toHaveBeenCalled()
    expect(type()).toBe(false)
  })

  it('wait for a new shortcut only, not one the window never answered or answers late', () => {
    vi.useFakeTimers()
    const { type, request, ran, typed } = shell()
    const unanswered = request('focus-address')
    vi.advanceTimersByTime(1500)
    const next = request('focus-address')
    type({ key: 'n', code: 'KeyN' })
    // The answer to the shortcut sent before goes nowhere; the keys wait for the new one.
    ran(unanswered)
    expect(typed()).toBe('')
    ran(next)
    expect(typed()).toBe('n')
  })

  it('send held keys on after a key typed once the wait is over, never while that key is handled', () => {
    vi.useFakeTimers()
    const { contents, type, request, typed } = shell()
    request('focus-address')
    type({ key: 'a', code: 'KeyA' })
    // The timer is late, as when main is busy: the next key comes after the wait, and waits for the ones before it.
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1500)
    expect(type({ key: 'b', code: 'KeyB' })).toBe(true)
    expect(contents.sendInputEvent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(typed()).toBe('ab')
  })

  it('pass on keys that do not type into the window, or that another handler took', () => {
    const { contents, type, request, ran } = shell()
    const hold = request('focus-address')
    expect(type({ key: 'Control', code: 'ControlLeft', control: true })).toBe(false)
    expect(type({ key: 'Shift', code: 'ShiftLeft', shift: true })).toBe(false)
    // A Cmd shortcut, which macOS's menu takes before the window.
    expect(type({ key: 'c', code: 'KeyC', meta: true })).toBe(false)
    // Keys an input method takes: a character it composes, a dead key, a key it processes.
    expect(type({ key: 'a', code: 'KeyA', isComposing: true })).toBe(false)
    expect(type({ key: 'Dead', code: 'Quote' })).toBe(false)
    expect(type({ key: 'Process', code: 'KeyA' })).toBe(false)
    expect(type({ type: 'keyUp' })).toBe(false)
    // A key there is no sending on, such as a media key, or a letter with no place on a US keyboard, such as the
    // Hungarian í: its text alone, sent on after a key down held back, would be dropped.
    expect(type({ key: 'AudioVolumeUp', code: 'AudioVolumeUp' })).toBe(false)
    expect(type({ key: 'í', code: 'IntlBackslash' })).toBe(false)
    const taken = { preventDefault: vi.fn(), defaultPrevented: true }
    contents.emit('before-input-event', taken, key())
    expect(taken.preventDefault).not.toHaveBeenCalled()
    ran(hold)
    expect(contents.sendInputEvent).not.toHaveBeenCalled()
  })

  it('are dropped when the window has closed meanwhile', () => {
    const { contents, type, request, ran, destroy } = shell()
    const hold = request('focus-address')
    type()
    destroy()
    ran(hold)
    expect(contents.sendInputEvent).not.toHaveBeenCalled()
  })

  it('are not held in a window main has not attached', () => {
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn(), sendInputEvent: vi.fn() })
    requestShellShortcut(contents as never, 'focus-address')
    expect(contents.send).toHaveBeenCalledExactlyOnceWith('browser:shortcut-requested', 'focus-address')
    expect(contents.listenerCount('before-input-event')).toBe(0)
  })
})

describe('a held key sent on', () => {
  it('goes by the ASCII character it types, as browser keys do, so another Latin layout keeps its shortcuts', () => {
    // AZERTY's A is on the US Q key: Ctrl+A selects all rather than quitting.
    expect(keyEventsOf(key({ key: 'a', code: 'KeyQ', control: true }), 'linux')).toEqual([
      { type: 'keyDown', keyCode: 'a', modifiers: ['control'] },
      { type: 'keyUp', keyCode: 'a', modifiers: ['control'] }
    ])
    // Dvorak's V is on the US Period key, so Ctrl+V still pastes; QWERTZ's Z stays Undo.
    expect(keyEventsOf(key({ key: 'v', code: 'Period', control: true }), 'linux')[0]).toEqual({ type: 'keyDown', keyCode: 'v', modifiers: ['control'] })
    expect(keyEventsOf(key({ key: 'z', code: 'KeyY', control: true }), 'linux')[0]).toEqual({ type: 'keyDown', keyCode: 'z', modifiers: ['control'] })
    // A letter with Caps Lock on and no Shift is the letter's key without Shift.
    expect(keyEventsOf(key({ key: 'A', code: 'KeyA' }))).toEqual([
      { type: 'keyDown', keyCode: 'a', modifiers: [] },
      { type: 'char', keyCode: 'A', modifiers: [] },
      { type: 'keyUp', keyCode: 'a', modifiers: [] }
    ])
    expect(keyEventsOf(key({ key: 'I', code: 'KeyI', shift: true })).map((event) => event.keyCode)).toEqual(['I', 'I', 'I'])
    expect(keyEventsOf(key({ key: '$', code: 'BracketRight' })).map((event) => event.keyCode)).toEqual(['$', '$', '$'])
  })

  it('goes by its place on a US keyboard for a letter of another script, with the text it typed', () => {
    // A Russian layout's ф is A's key.
    expect(keyEventsOf(key({ key: 'ф', code: 'KeyA' }))).toEqual([
      { type: 'keyDown', keyCode: 'a', modifiers: [] },
      { type: 'char', keyCode: 'ф', modifiers: [] },
      { type: 'keyUp', keyCode: 'a', modifiers: [] }
    ])
    // A key of the number row goes by its digit whatever it types, as AZERTY's &.
    expect(keyEventsOf(key({ key: '&', code: 'Digit1' })).map((event) => event.keyCode)).toEqual(['1', '&', '1'])
    expect(keyEventsOf(key({ key: '!', code: 'Digit1', shift: true })).map((event) => event.keyCode)).toEqual(['1', '!', '1'])
    expect(keyEventsOf(key({ key: ' ', code: 'Space' })).map((event) => event.keyCode)).toEqual(['Space', ' ', 'Space'])
    expect(keyEventsOf(key({ key: 'b', code: 'KeyB', isAutoRepeat: true }))[0]).toEqual({ type: 'keyDown', keyCode: 'b', modifiers: ['isautorepeat'] })
  })

  it('is the keypad\'s digit with Num Lock on, and the key it names with Num Lock off', () => {
    expect(keyEventsOf(key({ key: '7', code: 'Numpad7', location: 3 }))).toEqual([
      { type: 'keyDown', keyCode: 'num7', modifiers: ['iskeypad'] },
      { type: 'char', keyCode: '7', modifiers: ['iskeypad'] },
      { type: 'keyUp', keyCode: 'num7', modifiers: ['iskeypad'] }
    ])
    expect(keyEventsOf(key({ key: 'ArrowLeft', code: 'Numpad4', location: 3 })).map((event) => [event.type, event.keyCode])).toEqual([
      ['keyDown', 'Left'], ['keyUp', 'Left']
    ])
    expect(keyEventsOf(key({ key: 'Delete', code: 'NumpadDecimal', location: 3 })).map((event) => event.keyCode)).toEqual(['Delete', 'Delete'])
    expect(keyEventsOf(key({ key: '.', code: 'NumpadDecimal', location: 3 })).map((event) => event.keyCode)).toEqual(['.', '.', '.'])
  })

  it('submits a form with Enter, as the address field takes it', () => {
    expect(keyEventsOf(key({ key: 'Enter', code: 'Enter' })).map((event) => [event.type, event.keyCode])).toEqual([
      ['keyDown', 'Enter'], ['char', '\r'], ['keyUp', 'Enter']
    ])
    expect(keyEventsOf(key({ key: 'Enter', code: 'NumpadEnter' })).map((event) => event.keyCode)).toEqual(['Enter', '\r', 'Enter'])
    expect(keyEventsOf(key({ key: 'Enter', code: 'Enter', control: true })).map((event) => event.type)).toEqual(['keyDown', 'keyUp'])
  })

  it('types nothing for a key with a name or a Ctrl or Alt shortcut', () => {
    for (const [name, code, keyCode] of [['Backspace', 'Backspace', 'Backspace'], ['ArrowLeft', 'ArrowLeft', 'Left'], ['Escape', 'Escape', 'Escape'], ['Tab', 'Tab', 'Tab'], ['F5', 'F5', 'F5']]) {
      expect(keyEventsOf(key({ key: name, code })).map((event) => [event.type, event.keyCode])).toEqual([['keyDown', keyCode], ['keyUp', keyCode]])
    }
    expect(keyEventsOf(key({ key: 'f', code: 'KeyF', alt: true }), 'win32').map((event) => event.type)).toEqual(['keyDown', 'keyUp'])
    expect(keyEventsOf(key({ key: 'f', code: 'KeyF', alt: true }), 'linux').map((event) => event.type)).toEqual(['keyDown', 'keyUp'])
    // On Windows Ctrl+Alt with a plain letter or digit is a shortcut, not AltGr.
    expect(keyEventsOf(key({ key: 'q', code: 'KeyQ', control: true, alt: true }), 'win32').map((event) => event.type)).toEqual(['keyDown', 'keyUp'])
    expect(keyEventsOf(key({ key: 'q', code: 'KeyQ', control: true, alt: true }), 'linux').map((event) => event.type)).toEqual(['keyDown', 'keyUp'])
  })

  it('types what Option types on macOS, and AltGr, which Windows reports as Ctrl+Alt', () => {
    expect(keyEventsOf(key({ key: 'å', code: 'KeyA', alt: true }), 'darwin').map((event) => event.keyCode)).toEqual(['a', 'å', 'a'])
    expect(keyEventsOf(key({ key: '@', code: 'KeyQ', control: true, alt: true }), 'win32')).toEqual([
      { type: 'keyDown', keyCode: '@', modifiers: ['control', 'alt'] },
      { type: 'char', keyCode: '@', modifiers: ['control', 'alt'] },
      { type: 'keyUp', keyCode: '@', modifiers: ['control', 'alt'] }
    ])
    expect(keyEventsOf(key({ key: 'ą', code: 'KeyA', control: true, alt: true }), 'win32').map((event) => event.keyCode)).toEqual(['a', 'ą', 'a'])
  })

  it('is none for a key with no US place, whose text alone would be dropped', () => {
    expect(keyEventsOf(key({ key: 'ü', code: 'IntlBackslash' }))).toEqual([])
  })
})

describe('the keys held for a shortcut', () => {
  it('wait when a page sends one, held before the window is asked to run it', () => {
    const { contents, type, ran } = shell()
    const tabs = { activeTabId: 'shown', mcpTabGroups: new Map(), tabs: new Map([['shown', { url: 'https://site.example/' }]]) }
    const { runPageShortcut } = createBrowserShortcutRouting({
      takeOvers: { available: () => undefined, takeOverFromPage: vi.fn() },
      tabs: () => tabs as never,
      agentPresenceSnapshot: () => ({ workspaces: {} }) as never,
      mainWindowRefs: { window: { webContents: contents } as never }
    })
    runPageShortcut('reload', { tabId: 'shown', workspaceId: undefined })
    expect(type()).toBe(false)
    contents.send.mockImplementationOnce(() => expect(type()).toBe(true))
    runPageShortcut('focus-address', { tabId: 'shown', workspaceId: undefined })
    const [channel, action, hold] = contents.send.mock.calls.at(-1)!
    expect([channel, action, typeof hold]).toEqual(['browser:shortcut-requested', 'focus-address', 'number'])
    expect(type()).toBe(true)
    ran(hold)
  })

  it('wait when Command Palette is chosen from the menu', () => {
    const { contents, type, ran } = shell()
    createApplicationMenu({
      text: (text) => text, showWindow: vi.fn(), mainWindow: () => ({ id: 1, webContents: contents }) as never, checkForUpdates: vi.fn(),
      requestQuit: vi.fn(), runNativeBrowserAction: vi.fn(), runShortcut: vi.fn(), runPageNextPane: vi.fn(), tabs: () => null
    }).installApplicationMenu()
    const view = installed.template.find((menu) => menu.label === 'native.menu.view')!.submenu!
    view.find((item) => item.label === 'native.menu.commandPalette')!.click!({}, undefined, {})
    const [channel, action, hold] = contents.send.mock.calls[0]!
    expect([channel, action, typeof hold]).toEqual(['browser:shortcut-requested', 'command-palette', 'number'])
    expect(type()).toBe(true)
    ran(hold)
  })

  it('go on once the main window answers for its hold, and only from the main window', () => {
    const { contents, type, request, typed } = shell()
    const listeners = new Map<string, (event: IpcMainEvent, ...args: unknown[]) => void>()
    const assertMainShellSender = vi.fn()
    registerShellIpc({ on: (channel: string, listener: never) => { listeners.set(channel, listener) }, handle: vi.fn() } as never,
      { assertMainShellSender, handleBrowserIpc: vi.fn() } as never)
    const answer = (hold: unknown) => listeners.get('browser:shortcut-ran')!({ sender: contents } as never, hold)
    const hold = request('focus-address')
    type({ key: 'z', code: 'KeyZ' })
    answer('focus-address')
    answer(hold! + 1000)
    expect(contents.sendInputEvent).not.toHaveBeenCalled()
    answer(hold)
    expect(typed()).toBe('z')
    expect(assertMainShellSender).toHaveBeenCalledTimes(3)
    assertMainShellSender.mockImplementation(() => { throw new Error('Untrusted sender') })
    const next = request('focus-address')
    type({ key: 'y', code: 'KeyY' })
    expect(() => answer(next)).toThrow('Untrusted sender')
    expect(typed()).toBe('z')
    shellRanShortcut(contents as never, next!)
  })
})
