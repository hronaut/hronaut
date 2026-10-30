import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { withAgentInput } from '../agent-input-scope/agent-input-scope.js'
import { nativeInputAuthority } from '../native-input-authority/native-input-authority.js'
import { nativeTouchInput, notStartedTouchProgress, type NativeTouchInput, type NativeTouchProgress } from './touch-input.js'

/** How many moves a swipe sends on its way from the start point to the end point. */
const SWIPE_MOVES = 10

/**
 * How long one touch event waits for Chromium's acknowledgement. Chromium
 * acknowledges an event once the page's renderer handled it, which a busy or
 * hung renderer can delay indefinitely.
 */
const TOUCH_ACK_TIMEOUT_MS = 5_000

/** The gesture's first touch event was attempted; a failure from then on does not prove the page saw nothing. */
export class NativeTouchOutcomeUnknownError extends Error {
  constructor(cause: unknown) {
    super('Touch gesture outcome is unknown. Inspect fresh page state; do not replay automatically.', { cause })
    this.name = 'NativeTouchOutcomeUnknownError'
  }
}

/**
 * Sends one single-finger tap or straight swipe to the active, visible, awake
 * and unlocked page with touch emulation on, default zoom and no child
 * frames. A swipe moves in even steps over its duration. Every event is
 * checked first: any change to that environment, the call's authority or its
 * cancellation stops the gesture, and a contact that went down is then
 * cancelled, so Chromium never carries it into the next gesture.
 */
export async function touch(browser: Browser, input: NativeTouchInput, validateInput: (validateContext: () => void) => void,
  recordProgress: (progress: NativeTouchProgress) => void, signal?: AbortSignal): Promise<unknown> {
  const options = nativeTouchInput.parse(input)
  const tab = getTab(browser, options.tabId)
  const webContents = tab.webContents
  const generation = tab.nativeInputEnvironmentGeneration
  const selectionGeneration = browser.tabSelectionGeneration
  const splitGeneration = browser.splitViewGeneration
  const bounds = tab.view.getBounds()
  const authority = nativeInputAuthority(browser, tab, validateInput)
  const progress = notStartedTouchProgress()
  const publish = (): void => { recordProgress({ ...progress }) }
  let environmentChanged = false
  let debuggerDetached = false
  const changed = (): void => { environmentChanged = true }
  const navigationStarted = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
    // Any navigation of the page stops the gesture, within the document too, as the call's authority does.
    if (details.isMainFrame) changed()
  }
  const detached = (): void => { debuggerDetached = true; changed() }
  const debuggerChanged = (_event: Electron.Event, method: string): void => {
    if (['Page.frameAttached', 'Page.frameDetached', 'Page.frameResized'].includes(method)) changed()
  }
  // Observe transitions before entering the debugger queue, including changes
  // which revert to the original value while another operation is pending.
  tab.view.on('bounds-changed', changed)
  webContents.on('zoom-changed', changed)
  webContents.on('frame-created', changed)
  webContents.on('devtools-opened', changed)
  webContents.on('did-start-navigation', navigationStarted)
  webContents.on('render-process-gone', changed)
  webContents.on('destroyed', changed)
  webContents.debugger.on('message', debuggerChanged)
  webContents.debugger.on('detach', detached)
  browser.window.on('move', changed)
  browser.window.on('hide', changed)
  browser.window.on('minimize', changed)
  const validate = (): void => {
    authority.validate()
    if (signal?.aborted) throw new Error('Touch gesture cancelled; earlier touch effects are not rolled back')
    if (environmentChanged || generation !== tab.nativeInputEnvironmentGeneration
      || selectionGeneration !== browser.tabSelectionGeneration || splitGeneration !== browser.splitViewGeneration
      || JSON.stringify(tab.view.getBounds()) !== JSON.stringify(bounds)) {
      throw new Error('Touch environment changed; inspect fresh state before a new gesture')
    }
    if (browser.activeTabId !== tab.id || browser.splitView || browser.browserContentOccluded
      || !browser.window.isVisible() || browser.window.isMinimized() || !tab.view.getVisible()
      || !browser.window.contentView.children.includes(tab.view)) {
      throw new Error('Touch requires the active visible page outside split view; select it first')
    }
    if (tab.sleeping || tab.pageLifecycleState !== 'active') throw new Error('Touch requires an already awake, active page')
    // Like the other native input paths, any pending lock change, on any tab, holds the gesture back.
    if (browser.nativeInputLockMutations > 0) throw new Error('Touch is unavailable while a page input lock is changing; try again once it settles')
    if (browser.isHumanInteractionLocked(tab)) throw new Error('Touch requires an unlocked page; the person locked its input')
    if (browser.screenshotAreaSessions.has(webContents.id) || browser.elementPickerSessions.has(webContents.id)
      || browser.devToolsOpening.has(webContents.id) || webContents.isDevToolsOpened()) {
      throw new Error('Touch is unavailable during native selection or Developer Tools')
    }
    if (tab.emulationApplication !== 'confirmed' || tab.emulation.viewport?.touch !== true) {
      throw new Error('Touch requires touch emulation; turn it on with browser_emulate viewport.touch first')
    }
    if (webContents.getZoomFactor() !== 1) throw new Error('Touch requires default zoom')
    // Native frame metadata, not a page-authored DOM query. Reject all child
    // frames rather than guessing which renderer receives the input.
    if (webContents.mainFrame.framesInSubtree.length !== 1) throw new Error('Touch does not support pages containing child frames')
  }
  const end = options.gesture === 'swipe' ? { x: options.endX!, y: options.endY! } : undefined
  const durationMs = options.gesture === 'swipe' ? options.durationMs ?? 300 : 0
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', point?: { x: number; y: number }): Promise<void> =>
    withAcknowledgementTimeout(webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [], modifiers: 0 }))
  try {
    validate()
    await withAgentInput(browser, webContents, () => withDebugger(browser, webContents, async () => {
      try {
        validate()
        const metrics = await webContents.debugger.sendCommand('Page.getLayoutMetrics') as {
          cssVisualViewport?: { clientWidth: number; clientHeight: number; scale: number; offsetX: number; offsetY: number }
        }
        validate()
        const viewport = metrics.cssVisualViewport
        const inside = (point: { x: number; y: number }): boolean => viewport !== undefined
          && point.x < viewport.clientWidth && point.y < viewport.clientHeight && point.x < bounds.width && point.y < bounds.height
        if (!viewport || viewport.scale !== 1 || viewport.offsetX !== 0 || viewport.offsetY !== 0
          || !Number.isFinite(viewport.clientWidth) || !Number.isFinite(viewport.clientHeight)
          || !inside(options) || (end && !inside(end))) {
          throw new Error('Touch points must be inside the visible CSS viewport, without pinch zoom')
        }
        // No await between the final admission check and the first event.
        validate()
        progress.startAttempted = true
        publish()
        await send('touchStart', { x: options.x, y: options.y })
        if (end) {
          const started = performance.now()
          for (let step = 1; step <= SWIPE_MOVES; step += 1) {
            await waitUntil(started + durationMs * step / SWIPE_MOVES, validate, signal)
            validate()
            await send('touchMove', {
              x: options.x + (end.x - options.x) * step / SWIPE_MOVES,
              y: options.y + (end.y - options.y) * step / SWIPE_MOVES
            })
            progress.movesAcknowledged = step
            publish()
          }
        }
        validate()
        await send('touchEnd')
        progress.endAcknowledged = true
        publish()
      } finally {
        // Lift a contact that went down, whatever stopped the gesture, so
        // Chromium does not carry it into the next one. This is cleanup of the
        // agent's own contact, like a held key's release: it is sent after a
        // lock, a navigation or a move to another workspace too. A lock's
        // input barrier is applied through this same debugger queue, so it
        // cannot drop the cancel, and a document that never saw the contact
        // ignores its cancel.
        if (progress.startAttempted && !progress.endAcknowledged) {
          if (debuggerDetached || webContents.isDestroyed()) {
            // A detached debugger already dropped Chromium's record of the
            // contact, and a closed page takes no more gestures.
            progress.contactCleared = true
          } else {
            progress.cancelAttempted = true
            publish()
            try {
              await send('touchCancel')
              progress.cancelAcknowledged = true
            } catch {
              // Chromium drops its record of the contact as soon as it takes
              // the cancel, before it reports any error or the page answers; it
              // reports no contact when it holds none, and a session that can
              // no longer take the cancel has detached, which drops the record
              // too. The gesture's own error is reported.
              progress.contactCleared = true
            }
          }
          publish()
        }
      }
    }))
    // The page may already be navigating in answer to the gesture, as after a
    // click, so the environment is not checked again; the call's authority is.
    authority.validate()
    return {
      status: 'DISPATCH_ACKNOWLEDGED',
      gesture: options.gesture,
      x: options.x,
      y: options.y,
      ...(end ? { endX: end.x, endY: end.y, durationMs, moves: SWIPE_MOVES } : {}),
      contact: 'ENDED',
      nextAction: 'Read the page again to see what the gesture did; the acknowledgement is not proof of how the page responded.'
    }
  } catch (error) {
    if (progress.startAttempted) throw new NativeTouchOutcomeUnknownError(error)
    throw error
  } finally {
    authority.dispose()
    tab.view.removeListener('bounds-changed', changed)
    webContents.removeListener('zoom-changed', changed)
    webContents.removeListener('frame-created', changed)
    webContents.removeListener('devtools-opened', changed)
    webContents.removeListener('did-start-navigation', navigationStarted)
    webContents.removeListener('render-process-gone', changed)
    webContents.removeListener('destroyed', changed)
    webContents.debugger.removeListener('message', debuggerChanged)
    webContents.debugger.removeListener('detach', detached)
    browser.window.removeListener('move', changed)
    browser.window.removeListener('hide', changed)
    browser.window.removeListener('minimize', changed)
  }
}

/** A touch command's acknowledgement, or a rejection once it takes too long. */
async function withAcknowledgementTimeout(command: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      command,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Touch event was not acknowledged in time')), TOUCH_ACK_TIMEOUT_MS)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Waits until the deadline, checking the gesture's environment and cancellation meanwhile. */
function waitUntil(deadline: number, validate: () => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = (failed: boolean, error?: unknown): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      if (failed) reject(error)
      else resolve()
    }
    const aborted = (): void => { finish(true, new Error('Touch gesture cancelled; earlier touch effects are not rolled back')) }
    const tick = (): void => {
      try {
        validate()
        const remaining = deadline - performance.now()
        if (remaining <= 0) return finish(false)
        timer = setTimeout(tick, Math.min(20, remaining))
      } catch (error) { finish(true, error) }
    }
    signal?.addEventListener('abort', aborted, { once: true })
    tick()
  })
}
