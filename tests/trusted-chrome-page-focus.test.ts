import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
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
    occlusionSnapshot: { begin: vi.fn(), end: vi.fn() },
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

  manager.setBrowserContentOccluded(false)
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

    manager.setBrowserContentOccluded(false)
    expect(page.focus, type).not.toHaveBeenCalled()
  }
})

it('drops the pending focus when another tab became active during the exit', () => {
  const { manager, internals, shell, page, tab } = fixture()
  internals.focusTabOrTrustedChrome(tab)
  ;(manager as unknown as { activeTabId: string }).activeTabId = 'other'

  manager.setBrowserContentOccluded(false)
  expect(page.focus).not.toHaveBeenCalled()
  expect(shell.listenerCount('input-event')).toBe(0)
})
