import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
const electron = vi.hoisted(() => ({ focused: null as unknown }))
vi.mock('electron', () => ({
  session: {},
  WebContentsView: class {},
  nativeImage: {},
  shell: {},
  app: { getPath: () => '/tmp' },
  webContents: { getFocusedWebContents: () => electron.focused }
}))
import { Browser } from '../src/main/browser/browser.js'

afterEach(() => { electron.focused = null })

interface PageFocusInternals {
  focusTabOrTrustedChrome(tab: unknown): void
}

function fixture() {
  const shell = Object.assign(new EventEmitter(), { focus: vi.fn(), isDestroyed: () => false })
  const page = { id: 7, focus: vi.fn(), isDestroyed: () => false }
  const tab = { id: 'picked', url: 'https://example.test/', sleeping: false, webContents: page, view: { getVisible: () => true }, nativeInputEnvironmentGeneration: 0 }
  const manager = Object.assign(Object.create(Browser.prototype), {
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
  }) as Browser
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

it('keeps every page from the keyboard until trusted chrome closes once a sign-in closed while the person typed in it', () => {
  for (const order of ['picked first', 'withheld first'] as const) {
    const { manager, internals, shell, page, tab } = fixture()
    // The tab that asked closed, and the next one is picked while the sign-in's overlay plays its exit.
    if (order === 'picked first') internals.focusTabOrTrustedChrome(tab)
    manager.withholdKeyboardAfterQuestion()
    if (order === 'withheld first') internals.focusTabOrTrustedChrome(tab)
    expect(manager.keyboardPage(), order).toBeNull()
    // A key the person types meanwhile is the rest of their password, not a choice to stay in the shell.
    shell.emit('input-event', {}, { type: 'keyDown' })
    expect(shell.listenerCount('input-event'), order).toBe(0)

    manager.setBrowserContentOccluded(false, 1)
    expect(page.focus, order).not.toHaveBeenCalled()
    // Once trusted chrome is gone, nothing waits, and a page picked later takes the keyboard as usual.
    internals.focusTabOrTrustedChrome(tab)
    expect(page.focus, order).toHaveBeenCalledOnce()
  }
})

it('gives the keyboard back to the page once the person answers the question that came next', () => {
  const { manager, shell, page } = fixture()
  manager.withholdKeyboardAfterQuestion()
  // The person signs in to the sign-in that came next, which gives the keyboard back to the page that had it.
  manager.focusPageAfterQuestion(page as never)
  expect(manager.keyboardPage()).toBe(page)
  expect(shell.listenerCount('input-event')).toBe(1)
  manager.setBrowserContentOccluded(false, 1)
  expect(page.focus).toHaveBeenCalledOnce()
})

it('withholds nothing once trusted chrome no longer covers the pages', () => {
  const { manager, internals, page, tab } = fixture()
  manager.setBrowserContentOccluded(false, 1)
  manager.withholdKeyboardAfterQuestion()
  internals.focusTabOrTrustedChrome(tab)
  expect(page.focus).toHaveBeenCalledOnce()
  // Nor the next time trusted chrome covers them: the tab picked under it takes the keyboard once it closes.
  Object.assign(manager, { browserContentOccluded: true })
  internals.focusTabOrTrustedChrome(tab)
  manager.setBrowserContentOccluded(false, 3)
  expect(page.focus).toHaveBeenCalledTimes(2)
})
