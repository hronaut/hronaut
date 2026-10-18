import { screen } from 'electron'
import { hasEmulationOverrides } from '../emulation-state.js'
import type { RightClickEnvironmentAccess, RightClickEnvironmentTab } from './right-click-environment-access.js'

/** Preserve presentation and observe even temporary native-environment changes.
 * This owns admission only; the matching release never repeats these checks. */
export function rightClickEnvironment<Tab extends RightClickEnvironmentTab>(access: RightClickEnvironmentAccess<Tab>, tab: Tab): { validate(): void; dispose(): void } {
  const webContents = tab.webContents
  const generation = tab.nativeInputEnvironmentGeneration
  const selection = access.tabSelectionGeneration()
  const split = access.splitViewGeneration()
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
  access.window().on('move', invalidate)
  access.window().on('hide', invalidate)
  access.window().on('minimize', invalidate)
  screen.on('display-metrics-changed', invalidate)
  return {
    validate: () => {
      if (changed || generation !== tab.nativeInputEnvironmentGeneration
        || selection !== access.tabSelectionGeneration() || split !== access.splitViewGeneration()
        || JSON.stringify(tab.view.getBounds()) !== bounds || access.nativeInputLockMutations() > 0) {
        throw new Error('Right-click environment changed; inspect fresh state without replay')
      }
      if (access.activeTabId() !== tab.id || access.splitView() || access.browserContentOccluded()
        || !access.window().isVisible() || access.window().isMinimized() || !tab.view.getVisible()
        || !access.window().contentView.children.includes(tab.view) || tab.sleeping || tab.pageLifecycleState !== 'active') {
        throw new Error('Right-click requires the active visible, already awake page outside split view')
      }
      if (!access.isHumanInteractionLocked(tab)) throw new Error('Right-click requires a page locked in the trusted UI')
      if (access.screenshotAreaSessions().has(webContents.id) || access.elementPickerSessions().has(webContents.id)
        || access.devToolsOpening().has(webContents.id) || webContents.isDevToolsOpened()) {
        throw new Error('Right-click is unavailable during native selection or Developer Tools')
      }
      if (webContents.mainFrame.framesInSubtree.length !== 1) throw new Error('Right-click does not support pages containing child frames')
      if (webContents.getZoomFactor() !== 1 || tab.emulationApplication !== 'confirmed' || hasEmulationOverrides(tab.emulation)
        || screen.getDisplayMatching(access.window().getBounds()).scaleFactor !== 1) {
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
      access.window().removeListener('move', invalidate)
      access.window().removeListener('hide', invalidate)
      access.window().removeListener('minimize', invalidate)
      screen.removeListener('display-metrics-changed', invalidate)
    }
  }
}
