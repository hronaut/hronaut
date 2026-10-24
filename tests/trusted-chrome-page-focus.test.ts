import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
const electron = vi.hoisted(() => ({ focused: null as unknown }))
vi.mock('electron', () => ({
  session: {},
  WebContentsView: class {},
  nativeImage: {},
  shell: {},
  app: { getPath: () => '/tmp' },
  webContents: { getFocusedWebContents: () => electron.focused }
}))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'

interface PageFocusInternals {
  focusTabOrTrustedChrome(tab: unknown): void
}

function fixture() {
  const shell = Object.assign(new EventEmitter(), { focus: vi.fn(), isDestroyed: () => false })
  const page = { id: 7, focus: vi.fn(), isDestroyed: () => false }
  const tab = { id: 'picked', url: 'https://example.test/', sleeping: false, webContents: page, view: { getVisible: () => true }, nativeInputEnvironmentGeneration: 0 }
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    destroyed: false,
    window: { isDestroyed: () => false, isFocused: () => true, webContents: shell },
    tabs: new Map([[tab.id, tab]]),
    webContentsToTab: new Map([[page.id, tab.id]]),
    activeTabId: tab.id,
    splitView: null,
    browserContentOccluded: true,
    followAgentActivitySuspended: false,
    allHumanInteractionLocked: false,
    globallyUnlockedTabIds: new Set(),
    agentInputWebContents: new Set(),
    tabOverviewPreviewableTabs: new Set(),
    occludedEmulationFrames: [],
    mcpActivityFollower: { setOccluded: vi.fn() },
    occlusionSnapshot: { begin: vi.fn(), end: vi.fn(), confirmPagesHidden: vi.fn() },
    layout: vi.fn()
  }) as BrowserTabsManager
  return { manager, internals: manager as unknown as PageFocusInternals, shell, page, tab }
}

it('focuses a tab picked while trusted chrome plays its exit once the page is shown again', () => {
  const { manager, internals, shell, page, tab } = fixture()

  internals.focusTabOrTrustedChrome(tab)
  // The page is still under the closing overlay, where it would take keys typed into the shell.
  expect(page.focus).not.toHaveBeenCalled()
  expect(shell.listenerCount('input-event')).toBe(1)

  manager.setBrowserContentOccluded(false, 1)
  expect(page.focus).toHaveBeenCalledOnce()
  expect(shell.listenerCount('input-event')).toBe(0)
})

it('keeps a click or key press in the shell during the exit instead of focusing the picked tab', () => {
  for (const type of ['mouseDown', 'rawKeyDown', 'keyDown']) {
    const { manager, internals, shell, page, tab } = fixture()
    internals.focusTabOrTrustedChrome(tab)
    shell.emit('input-event', {}, { type: 'mouseMove' })
    expect(shell.listenerCount('input-event')).toBe(1)
    shell.emit('input-event', {}, { type })
    expect(shell.listenerCount('input-event')).toBe(0)

    manager.setBrowserContentOccluded(false, 1)
    expect(page.focus, type).not.toHaveBeenCalled()
  }
})

it('still focuses the page when the key that closed trusted chrome repeats while held', () => {
  const { manager, internals, shell, page, tab } = fixture()
  internals.focusTabOrTrustedChrome(tab)
  // Enter held on a dialog's button: its repeats used to keep the page from getting the keyboard back.
  for (const type of ['rawKeyDown', 'keyDown']) shell.emit('input-event', {}, { type, modifiers: ['isautorepeat'] })
  expect(shell.listenerCount('input-event')).toBe(1)

  manager.setBrowserContentOccluded(false, 1)
  expect(page.focus).toHaveBeenCalledOnce()
})

it('names the page that has the keyboard, or takes it once trusted chrome closes, and no page while the shell has it', () => {
  const { manager, internals, shell, page, tab } = fixture()
  electron.focused = page
  expect(manager.keyboardPage()).toBe(page)
  electron.focused = shell
  expect(manager.keyboardPage()).toBeNull()

  // A second question asked while the first one's exit plays: the shell has the keyboard, which the page takes next.
  internals.focusTabOrTrustedChrome(tab)
  expect(manager.keyboardPage()).toBe(page)
  shell.emit('input-event', {}, { type: 'mouseDown' })
  expect(manager.keyboardPage()).toBeNull()
  electron.focused = null
})

it('drops the pending focus when another tab became active during the exit', () => {
  const { manager, internals, shell, page, tab } = fixture()
  internals.focusTabOrTrustedChrome(tab)
  ;(manager as unknown as { activeTabId: string }).activeTabId = 'other'

  manager.setBrowserContentOccluded(false, 1)
  expect(page.focus).not.toHaveBeenCalled()
  expect(shell.listenerCount('input-event')).toBe(0)
})

it('says once more that the pages are off the screen when asked to cover pages it already covers', () => {
  // The shell's question over the pages, such as a permission dialog, takes answers only after this report.
  const { manager } = fixture()
  const snapshot = (manager as unknown as { occlusionSnapshot: { begin: ReturnType<typeof vi.fn>; confirmPagesHidden: ReturnType<typeof vi.fn> } })
    .occlusionSnapshot
  manager.setBrowserContentOccluded(true, 3)
  expect(snapshot.confirmPagesHidden).toHaveBeenCalledExactlyOnceWith(3)
  expect(snapshot.begin).not.toHaveBeenCalled()
})
