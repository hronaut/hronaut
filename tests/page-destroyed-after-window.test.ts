import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { publishPageGeometry } from '../src/main/browser/page-geometry/page-geometry.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { recoverFromDestroyedPage } from '../src/main/browser/tab-events/page-destroyed-events.js'

// When Hronaut exited at once, Electron destroyed the window before the tabs' pages, and each page's recovery read the
// window's webContents: "Object has been destroyed" was an uncaught exception in the main process.

/** A destroyed window, whose webContents and contentView Electron no longer gives. */
function destroyedWindow(): BrowserWindow {
  const gone = () => { throw new TypeError('Object has been destroyed') }
  return Object.defineProperties({ isDestroyed: () => true }, {
    webContents: { get: gone },
    contentView: { get: gone }
  }) as unknown as BrowserWindow
}

describe('a tab\'s page destroyed after the window', () => {
  it('leaves the tab alone, with no recovery and no new Home tab', () => {
    const tab = { id: 'tab', url: 'https://example.test/', loading: true, lastActiveAt: 0, view: {}, webContents: { isDestroyed: () => true } } as unknown as BrowserTab
    const createTab = vi.fn(async () => undefined)
    const runWalletLifecycleAction = vi.fn()
    const browser = new Proxy({
      destroyed: false,
      window: destroyedWindow(),
      tabs: new Map([[tab.id, tab]]),
      mcpTabGroups: new Map(),
      activeTabId: null,
      splitViewContains: () => false,
      createTab,
      runWalletLifecycleAction
    }, { get: (target, key) => (target as Record<PropertyKey, unknown>)[key] ?? vi.fn() }) as unknown as Browser

    expect(() => recoverFromDestroyedPage(browser, tab)).not.toThrow()
    expect(createTab).not.toHaveBeenCalled()
    expect(runWalletLifecycleAction).not.toHaveBeenCalled()
    expect(tab.loading).toBe(true)
  })

  it('publishes no page geometry once the window is gone', () => {
    expect(() => publishPageGeometry({ window: destroyedWindow() } as unknown as Browser)).not.toThrow()
  })
})
