import { screen } from 'electron'
import { nativeWheelInput, NativeWheelOutcomeUnknownError, type NativeWheelInput } from '../native-wheel.js'
import type { AgentWheelAccess, AgentWheelTab } from './agent-wheel-access.js'

/** How long wheel events after an agent's wheel call still count as the agent's. */
const AGENT_WHEEL_SETTLE_MS = 250

/** Whether an agent's wheel call on the page is running or just ended, so its wheel events are not the person scrolling. */
export function agentWheelUnderWay<Tab extends AgentWheelTab>(access: AgentWheelAccess<Tab>, webContentsId: number): boolean {
  const marker = access.agentWheel().get(webContentsId)
  if (!marker) return false
  if (marker.pending > 0 || performance.now() < marker.until) return true
  access.agentWheel().delete(webContentsId)
  return false
}

/**
 * Sends one native wheel event at a point of the active, visible, awake and
 * unlocked page, with default zoom, no emulation overrides, display scale 1
 * and no child frames. Any change to that environment while the call waits
 * rejects it; a failure after the event was sent leaves its outcome unknown.
 */
export async function wheel<Tab extends AgentWheelTab>(access: AgentWheelAccess<Tab>, input: NativeWheelInput, validateInput: (validateContext: () => void) => void, markAttempted: () => void): Promise<unknown> {
  const options = nativeWheelInput.parse(input)
  const tab = access.getTab(options.tabId)
  const webContents = tab.webContents
  const generation = tab.nativeInputEnvironmentGeneration
  const selectionGeneration = access.tabSelectionGeneration()
  const splitGeneration = access.splitViewGeneration()
  const bounds = JSON.stringify(tab.view.getBounds())
  const authority = access.nativeInputAuthority(tab, validateInput)
  let environmentChanged = false
  let attempted = false
  const changed = (): void => { environmentChanged = true }
  const debuggerChanged = (_event: Electron.Event, method: string): void => {
    if (['Page.frameAttached', 'Page.frameDetached', 'Page.frameResized'].includes(method)) changed()
  }
  // Observe transitions before entering the debugger queue, including changes
  // which revert to the original value while another operation is pending.
  tab.view.on('bounds-changed', changed)
  webContents.on('zoom-changed', changed)
  webContents.on('frame-created', changed)
  webContents.on('devtools-opened', changed)
  webContents.debugger.on('message', debuggerChanged)
  webContents.debugger.on('detach', changed)
  access.window().on('move', changed)
  access.window().on('hide', changed)
  access.window().on('minimize', changed)
  screen.on('display-metrics-changed', changed)
  const validate = (): void => {
    authority.validate()
    if (environmentChanged || generation !== tab.nativeInputEnvironmentGeneration
      || selectionGeneration !== access.tabSelectionGeneration() || splitGeneration !== access.splitViewGeneration()
      || JSON.stringify(tab.view.getBounds()) !== bounds) {
      throw new Error('Wheel environment changed; inspect fresh state before a new call')
    }
    if (access.activeTabId() !== tab.id || access.splitView() || access.browserContentOccluded()
      || !access.window().isVisible() || access.window().isMinimized() || !tab.view.getVisible()
      || !access.window().contentView.children.includes(tab.view)) {
      throw new Error('Wheel requires the active visible page outside split view; select it in the trusted UI first')
    }
    if (tab.sleeping || tab.pageLifecycleState !== 'active') throw new Error('Wheel requires an already awake, active page')
    if (access.nativeInputLockMutations() > 0 || access.isHumanInteractionLocked(tab)) throw new Error('Wheel requires an explicitly unlocked page; unlock it in the trusted UI first')
    if (access.screenshotAreaSessions().has(webContents.id) || access.elementPickerSessions().has(webContents.id)
      || access.devToolsOpening().has(webContents.id) || webContents.isDevToolsOpened()) {
      throw new Error('Wheel is unavailable during native selection or Developer Tools')
    }
    if (webContents.getZoomFactor() !== 1 || tab.emulationApplication !== 'confirmed' || access.hasEmulationOverrides(tab.emulation)
      || screen.getDisplayMatching(access.window().getBounds()).scaleFactor !== 1) {
      throw new Error('Wheel requires default zoom, no emulation overrides, and display scale 1')
    }
    // Native frame metadata, not a page-authored DOM query. Reject all child
    // frames rather than guessing which renderer receives the input.
    if (webContents.mainFrame.framesInSubtree.length !== 1) throw new Error('Wheel does not support pages containing child frames')
  }
  try {
    validate()
    return await access.withDebugger(webContents, async () => {
      validate()
      const metrics = await webContents.debugger.sendCommand('Page.getLayoutMetrics') as {
        cssVisualViewport?: { clientWidth: number; clientHeight: number; scale: number; offsetX: number; offsetY: number }
      }
      validate()
      const viewport = metrics.cssVisualViewport
      if (!viewport || viewport.scale !== 1 || viewport.offsetX !== 0 || viewport.offsetY !== 0
        || !Number.isFinite(viewport.clientWidth) || !Number.isFinite(viewport.clientHeight)
        || options.x >= viewport.clientWidth || options.y >= viewport.clientHeight) {
        throw new Error('Wheel point must be inside a default visible CSS viewport')
      }
      // No await, focus transfer, synthetic pointer movement, or compositor
      // unlock between the final admission check and the single command.
      validate()
      markAttempted()
      attempted = true
      // The agent's own wheel input is not the person scrolling. Chromium sends the wheel's
      // phase end after the command returns, so the mark outlives the call briefly.
      const marker = access.agentWheel().get(webContents.id) ?? { pending: 0, until: 0 }
      marker.pending += 1
      access.agentWheel().set(webContents.id, marker)
      try {
        await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: options.x, y: options.y,
          deltaX: options.deltaX, deltaY: options.deltaY, buttons: 0, modifiers: 0
        })
      } finally {
        marker.pending -= 1
        marker.until = performance.now() + AGENT_WHEEL_SETTLE_MS
      }
      validate()
      return { status: 'DISPATCH_ACKNOWLEDGED', x: options.x, y: options.y, deltaX: options.deltaX, deltaY: options.deltaY }
    })
  } catch (error) {
    if (attempted) throw new NativeWheelOutcomeUnknownError(error)
    throw error
  } finally {
    authority.dispose()
    tab.view.removeListener('bounds-changed', changed)
    webContents.removeListener('zoom-changed', changed)
    webContents.removeListener('frame-created', changed)
    webContents.removeListener('devtools-opened', changed)
    webContents.debugger.removeListener('message', debuggerChanged)
    webContents.debugger.removeListener('detach', changed)
    access.window().removeListener('move', changed)
    access.window().removeListener('hide', changed)
    access.window().removeListener('minimize', changed)
    screen.removeListener('display-metrics-changed', changed)
  }
}
