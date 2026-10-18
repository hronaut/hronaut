import { z } from 'zod'
import type { AgentTouchAccess, AgentTouchTab } from './agent-touch-access.js'

/** How many moves a swipe sends on its way from the start point to the end point. */
export const SWIPE_MOVES = 10

/** How long one touch event waits for Chromium's acknowledgement, which never comes for an event the page's input barrier drops. */
const TOUCH_ACK_TIMEOUT_MS = 5_000

const coordinate = z.number().finite().min(0).max(16384)

/** One single-finger gesture in viewport CSS pixels: a tap at a point, or a straight swipe from it to an end point. */
export const nativeTouchFields = {
  gesture: z.enum(['tap', 'swipe']),
  x: coordinate,
  y: coordinate,
  endX: coordinate.optional(),
  endY: coordinate.optional(),
  durationMs: z.number().int().min(50).max(2000).optional()
}

/** A swipe names its end point and may name its duration; a tap names neither. */
export function refineNativeTouch(input: { gesture: 'tap' | 'swipe'; x: number; y: number; endX?: number; endY?: number; durationMs?: number }, context: z.RefinementCtx): void {
  if (input.gesture === 'tap') {
    if (input.endX !== undefined || input.endY !== undefined || input.durationMs !== undefined) {
      context.addIssue({ code: 'custom', message: 'A tap takes only x and y; endX, endY and durationMs are for a swipe' })
    }
    return
  }
  if (input.endX === undefined || input.endY === undefined) {
    context.addIssue({ code: 'custom', message: 'A swipe needs endX and endY' })
  } else if (input.endX === input.x && input.endY === input.y) {
    context.addIssue({ code: 'custom', message: 'A swipe must end at another point than it starts' })
  }
}

export const nativeTouchInput = z.object({ tabId: z.string().min(1), ...nativeTouchFields }).strict().superRefine(refineNativeTouch)

export type NativeTouchInput = z.infer<typeof nativeTouchInput>

/** How far a gesture got, from main-process bookkeeping only; never accepted from MCP arguments. */
export interface NativeTouchProgress {
  startAttempted: boolean
  movesAcknowledged: number
  endAcknowledged: boolean
  cancelAttempted: boolean
  cancelAcknowledged: boolean
}

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
 * cancelled in the same page when it is still in place and unlocked. A
 * contact left unconfirmed blocks further gestures on the page until it
 * closes, since Chromium would otherwise carry it into the next gesture.
 */
export async function touch<Tab extends AgentTouchTab>(access: AgentTouchAccess<Tab>, input: NativeTouchInput, validateInput: (validateContext: () => void) => void,
  recordProgress: (progress: NativeTouchProgress) => void, signal?: AbortSignal): Promise<unknown> {
  const options = nativeTouchInput.parse(input)
  const tab = access.getTab(options.tabId)
  const webContents = tab.webContents
  if (access.unconfirmedTouchContacts().has(webContents)) {
    throw new Error('An earlier touch contact on this page was never confirmed lifted; close this tab before another touch gesture. Navigation does not lift it.')
  }
  const generation = tab.nativeInputEnvironmentGeneration
  const selectionGeneration = access.tabSelectionGeneration()
  const splitGeneration = access.splitViewGeneration()
  const bounds = tab.view.getBounds()
  const authority = access.nativeInputAuthority(tab, validateInput)
  const progress: NativeTouchProgress = { startAttempted: false, movesAcknowledged: 0, endAcknowledged: false, cancelAttempted: false, cancelAcknowledged: false }
  const publish = (): void => { recordProgress({ ...progress }) }
  let environmentChanged = false
  let documentReplaced = false
  let debuggerDetached = false
  const changed = (): void => { environmentChanged = true }
  const replaced = (): void => { environmentChanged = true; documentReplaced = true }
  const navigationStarted = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
    // A navigation of the page itself can replace the document before an end or a cancel would arrive.
    if (details.isMainFrame && !details.isSameDocument) replaced()
  }
  const detached = (): void => { debuggerDetached = true; replaced() }
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
  webContents.on('render-process-gone', replaced)
  webContents.on('destroyed', replaced)
  webContents.debugger.on('message', debuggerChanged)
  webContents.debugger.on('detach', detached)
  access.window().on('move', changed)
  access.window().on('hide', changed)
  access.window().on('minimize', changed)
  const validate = (): void => {
    authority.validate()
    if (signal?.aborted) throw new Error('Touch gesture cancelled; earlier touch effects are not rolled back')
    if (environmentChanged || generation !== tab.nativeInputEnvironmentGeneration
      || selectionGeneration !== access.tabSelectionGeneration() || splitGeneration !== access.splitViewGeneration()
      || JSON.stringify(tab.view.getBounds()) !== JSON.stringify(bounds)) {
      throw new Error('Touch environment changed; inspect fresh state before a new gesture')
    }
    if (access.activeTabId() !== tab.id || access.splitView() || access.browserContentOccluded()
      || !access.window().isVisible() || access.window().isMinimized() || !tab.view.getVisible()
      || !access.window().contentView.children.includes(tab.view)) {
      throw new Error('Touch requires the active visible page outside split view; select it first')
    }
    if (tab.sleeping || tab.pageLifecycleState !== 'active') throw new Error('Touch requires an already awake, active page')
    if (access.nativeInputLockMutations() > 0 || access.isHumanInteractionLocked(tab)) throw new Error('Touch requires an unlocked page; the person locked its input')
    if (access.screenshotAreaSessions().has(webContents.id) || access.elementPickerSessions().has(webContents.id)
      || access.devToolsOpening().has(webContents.id) || webContents.isDevToolsOpened()) {
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
    await access.withAgentInput(webContents, () => access.withDebugger(webContents, async () => {
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
        // Lift a contact that went down in the page it went down in. A
        // replaced document never receives it, and a locked page's input
        // barrier would drop it unacknowledged.
        if (progress.startAttempted && !progress.endAcknowledged && !documentReplaced && !webContents.isDestroyed()
          && access.nativeInputLockMutations() === 0 && !access.isHumanInteractionLocked(tab)) {
          progress.cancelAttempted = true
          publish()
          try {
            await send('touchCancel')
            progress.cancelAcknowledged = true
            publish()
          } catch {
            // The contact stays unconfirmed; the gesture's own error is reported.
          }
        }
      }
    }))
    // The page may already be navigating in answer to the gesture, so only the call's authority is checked again.
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
    // Detaching the debugger clears Chromium's record of the contact.
    if (progress.startAttempted && !progress.endAcknowledged && !progress.cancelAcknowledged && !debuggerDetached && !webContents.isDestroyed()) {
      access.unconfirmedTouchContacts().add(webContents)
      const forget = (): void => { access.unconfirmedTouchContacts().delete(webContents) }
      webContents.once('destroyed', forget)
      webContents.debugger.once('detach', forget)
    }
    authority.dispose()
    tab.view.removeListener('bounds-changed', changed)
    webContents.removeListener('zoom-changed', changed)
    webContents.removeListener('frame-created', changed)
    webContents.removeListener('devtools-opened', changed)
    webContents.removeListener('did-start-navigation', navigationStarted)
    webContents.removeListener('render-process-gone', replaced)
    webContents.removeListener('destroyed', replaced)
    webContents.debugger.removeListener('message', debuggerChanged)
    webContents.debugger.removeListener('detach', detached)
    access.window().removeListener('move', changed)
    access.window().removeListener('hide', changed)
    access.window().removeListener('minimize', changed)
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
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      if (error === undefined) resolve()
      else reject(error)
    }
    const aborted = (): void => { finish(new Error('Touch gesture cancelled; earlier touch effects are not rolled back')) }
    const tick = (): void => {
      try {
        validate()
        const remaining = deadline - performance.now()
        if (remaining <= 0) return finish()
        timer = setTimeout(tick, Math.min(20, remaining))
      } catch (error) { finish(error) }
    }
    signal?.addEventListener('abort', aborted, { once: true })
    tick()
  })
}
