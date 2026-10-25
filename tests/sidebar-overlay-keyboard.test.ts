import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp', isPackaged: true } }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { attachPageKeyboardEvents } from '../src/main/browser/tab-events/page-keyboard-events.js'
import type { PageKeyboardEventsAccess, PageKeyboardEventsTab } from '../src/main/browser/tab-events/page-keyboard-events-access.js'
import { createOverlaySurfaces } from '../src/main/windows/overlay-surfaces.js'

type KeyInput = Partial<Electron.Input> & { type: Electron.Input['type'] }

function key(input: KeyInput): Electron.Input {
  return { key: '', code: '', isAutoRepeat: false, isComposing: false, control: false, meta: false, alt: false, shift: false, location: 0, modifiers: [], ...input } as Electron.Input
}

/** Sends a key to a view's contents as Electron does, and says whether a listener kept it from the view. */
function press(contents: EventEmitter, input: KeyInput): boolean {
  const event = { preventDefault: vi.fn() }
  contents.emit('before-input-event', event, key(input))
  return event.preventDefault.mock.calls.length > 0
}

/** The rail's view as overlay-surfaces loads it, with the shell's held keys kept by a tab manager. */
async function railView() {
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, isFocused: () => true, send: vi.fn(), setZoomFactor: vi.fn() })
  const held = new Set<string>()
  const tabs = Object.assign(Object.create(BrowserTabsManager.prototype), { shellHeldKeys: held }) as BrowserTabsManager
  const pointerActivity = vi.fn()
  const runShortcut = vi.fn()
  const loaded = { view: { setBounds: vi.fn() }, webContents: contents }
  const surfaces = createOverlaySurfaces({
    trustedShellUrl: () => 'file:///app/index.html',
    agentCardView: {} as never,
    agentCards: {} as never,
    toastOverlayView: {} as never,
    toastOverlay: {} as never,
    tooltipView: {} as never,
    sidebarOverlayView: { ensure: async () => loaded as never, present: vi.fn(), withdraw: vi.fn() },
    sidebarOverlay: { pointerActivity },
    sidebarOverlayKeyboard: { noteKey: (input) => tabs.noteShellKey(input), runShortcut },
    shellTooltips: { shownId: undefined, hide: vi.fn() },
    statusBubbleView: {} as never,
    statusBubble: {} as never
  })
  await surfaces.ensureSidebarOverlaySurface()
  // The view is loaded once and reused; its listeners are attached once.
  await surfaces.ensureSidebarOverlaySurface()
  return { contents, held, pointerActivity, runShortcut }
}

/** A page whose keys the tab manager follows, with nothing else going on. */
function page(held: Set<string>) {
  const contents = Object.assign(new EventEmitter(), { id: 7 })
  const tab: PageKeyboardEventsTab = { id: 'tab-1', humanInteractionGeneration: 0, lastHumanInteractionAt: 0, lastActiveAt: 0 }
  const access: PageKeyboardEventsAccess<PageKeyboardEventsTab> = {
    browserContentOccluded: () => false,
    agentInputWebContents: () => new Map(),
    screenshotAreaSessions: () => new Map(),
    cancelScreenshotArea: async () => false,
    elementPickerSessions: () => new Map(),
    cancelElementPicker: async () => false,
    consumeExpectedAgentKeyboardInput: () => false,
    pageShortcut: (requested) => requested,
    isHumanInteractionLocked: () => false,
    shellHeldKeys: () => held,
    reproRecorder: () => ({ observeReproKeyboard: vi.fn() }),
    scheduleTabOverviewPreview: vi.fn(),
    mcpActivityFollower: () => ({ noteHumanInput: vi.fn() }),
    options: () => ({})
  }
  attachPageKeyboardEvents(access, tab, contents as never)
  return contents
}

describe('keys pressed in the tab rail opened over the page', () => {
  it('do not repeat into the page the rail hands the focus to while they are held', async () => {
    const { contents, held } = await railView()
    // Delete on a tab focused in the rail closes it, and the page of the tab that takes its place gets the focus.
    expect(press(contents, { type: 'rawKeyDown', key: 'Delete', code: 'Delete' })).toBe(false)
    expect([...held]).toEqual(['Delete'])
    const next = page(held)
    expect(press(next, { type: 'rawKeyDown', key: 'Delete', code: 'Delete', isAutoRepeat: true })).toBe(true)
    expect(press(next, { type: 'rawKeyDown', key: 'Delete', code: 'Delete', isAutoRepeat: true })).toBe(true)
    // A key pressed in the page afresh reaches it, and repeats there.
    expect(press(next, { type: 'rawKeyDown', key: 'Delete', code: 'Delete' })).toBe(false)
    expect(press(next, { type: 'rawKeyDown', key: 'Delete', code: 'Delete', isAutoRepeat: true })).toBe(false)
    // A key released in the rail is no longer held there.
    press(contents, { type: 'rawKeyDown', key: 'Enter', code: 'Enter' })
    press(contents, { type: 'keyUp', key: 'Enter', code: 'Enter' })
    expect(held.size).toBe(0)
  })

  it('run browser shortcuts as in the shell, and leave the rail its own keys', async () => {
    const { contents, runShortcut } = await railView()
    expect(press(contents, { type: 'keyDown', key: 't', code: 'KeyT', control: process.platform !== 'darwin', meta: process.platform === 'darwin' })).toBe(true)
    expect(runShortcut).toHaveBeenLastCalledWith('new-tab')
    if (process.platform !== 'darwin') {
      // The rail has no website to keep F5.
      expect(press(contents, { type: 'keyDown', key: 'F5', code: 'F5' })).toBe(true)
      expect(runShortcut).toHaveBeenLastCalledWith('reload')
      // F6 goes on to the page, as in the shell.
      expect(press(contents, { type: 'keyDown', key: 'F6', code: 'F6' })).toBe(true)
      expect(runShortcut).toHaveBeenLastCalledWith('focus-next-pane')
    }
    expect(runShortcut).toHaveBeenCalledTimes(process.platform === 'darwin' ? 1 : 3)
    for (const input of [
      { type: 'keyDown', key: 'Escape', code: 'Escape' },
      { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown' },
      { type: 'keyDown', key: 'Delete', code: 'Delete' },
      { type: 'keyDown', key: 't', code: 'KeyT', control: true, meta: true, isAutoRepeat: true },
      { type: 'keyUp', key: 't', code: 'KeyT', control: true }
    ] as KeyInput[]) expect(press(contents, input)).toBe(false)
    expect(runShortcut).toHaveBeenCalledTimes(process.platform === 'darwin' ? 1 : 3)
  })

  it('note who has keyboard focus as the pointer comes onto the rail', async () => {
    const { contents, pointerActivity } = await railView()
    contents.emit('before-mouse-event', {}, { type: 'mouseMove', x: 4, y: 4 })
    expect(pointerActivity).toHaveBeenCalledOnce()
  })
})
