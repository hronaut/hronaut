import { screen } from 'electron'
import { hasEmulationOverrides } from '../emulation-state.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'

/** Preserve presentation and observe even temporary native-environment changes.
 * This owns admission only; the matching release never repeats these checks. */
export function rightClickEnvironment(browser: Browser, tab: BrowserTab): { validate(): void; dispose(): void } {
  const webContents = tab.webContents
  const generation = tab.nativeInputEnvironmentGeneration
  const selection = browser.tabSelectionGeneration
  const split = browser.splitViewGeneration
  const bounds = JSON.stringify(tab.view.getBounds())
  let changed = false
  const invalidate = (): void => { changed = true }
  const debuggerChanged = (_event: Electron.Event, method: string): void => {
    if (['Page.frameAttached', 'Page.frameDetached', 'Page.frameResized'].includes(method)) invalidate()
  }
  tab.view.on('bounds-changed', invalidate)
  webContents.on('zoom-changed', invalidate)
  webContents.on('frame-created', invalidate)
  webContents.on('devtools-opened', invalidate)
  webContents.debugger.on('message', debuggerChanged)
  webContents.debugger.on('detach', invalidate)
  browser.window.on('move', invalidate)
  browser.window.on('hide', invalidate)
  browser.window.on('minimize', invalidate)
  screen.on('display-metrics-changed', invalidate)
  return {
    validate: () => {
      if (changed || generation !== tab.nativeInputEnvironmentGeneration
        || selection !== browser.tabSelectionGeneration || split !== browser.splitViewGeneration
        || JSON.stringify(tab.view.getBounds()) !== bounds || browser.nativeInputLockMutations > 0) {
        throw new Error('Right-click environment changed; inspect fresh state without replay')
      }
      if (browser.activeTabId !== tab.id || browser.splitView || browser.browserContentOccluded
        || !browser.window.isVisible() || browser.window.isMinimized() || !tab.view.getVisible()
        || !browser.window.contentView.children.includes(tab.view) || tab.sleeping || tab.pageLifecycleState !== 'active') {
        throw new Error('Right-click requires the active visible, already awake page outside split view')
      }
      if (!browser.isHumanInteractionLocked(tab)) throw new Error('Right-click requires a page locked in the trusted UI')
      if (browser.screenshotAreaSessions.has(webContents.id) || browser.elementPickerSessions.has(webContents.id)
        || browser.devToolsOpening.has(webContents.id) || webContents.isDevToolsOpened()) {
        throw new Error('Right-click is unavailable during native selection or Developer Tools')
      }
      if (webContents.mainFrame.framesInSubtree.length !== 1) throw new Error('Right-click does not support pages containing child frames')
      if (webContents.getZoomFactor() !== 1 || tab.emulationApplication !== 'confirmed' || hasEmulationOverrides(tab.emulation)
        || screen.getDisplayMatching(browser.window.getBounds()).scaleFactor !== 1) {
        throw new Error('Right-click requires default zoom, no emulation overrides, and display scale 1')
      }
    },
    dispose: () => {
      tab.view.removeListener('bounds-changed', invalidate)
      webContents.removeListener('zoom-changed', invalidate)
      webContents.removeListener('frame-created', invalidate)
      webContents.removeListener('devtools-opened', invalidate)
      webContents.debugger.removeListener('message', debuggerChanged)
      webContents.debugger.removeListener('detach', invalidate)
      browser.window.removeListener('move', invalidate)
      browser.window.removeListener('hide', invalidate)
      browser.window.removeListener('minimize', invalidate)
      screen.removeListener('display-metrics-changed', invalidate)
    }
  }
}
