import { z } from 'zod'
import { parseBrowserKeyPress } from '../../../shared/keyboard-input.js'
import {
  NativeKeyHoldOutcomeUnknownError,
  waitForNativeKeyHold,
  type NativeInputDispatchObserver,
  type NativeKeyHoldProgress
} from '../native-key-hold.js'
import { nativeKeyDescription } from '../native-keyboard.js'
import type { Browser } from '../browser.js'
import { sendAuthorizedAgentInputCommand } from '../agent-input-authorization/agent-input-authorization.js'
import { getTab } from '../browser-core.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { withAgentInput } from '../agent-input-scope/agent-input-scope.js'
import { nativeInputAuthority } from '../native-input-authority/native-input-authority.js'
import { inputLockChanging } from '../interaction-lock/input-lock-state.js'
import type { BrowserTab } from '../browser-tab.js'
import { printDialogHolds, whenPrintDialogCloses } from '../print-dialog-guard.js'
import { websiteDialogHolds, whenWebsiteDialogCloses } from '../website-dialog-guard.js'

/**
 * Keys a sequence may hold: the keys browser_hold_key holds, without Insert, whose Shift chord pastes the person's
 * clipboard, plus the left and right Shift, the one modifier, which games use to run or dash. Control, Alt and Meta stay
 * out, so a sequence never presses a browser or system shortcut.
 */
const namedSequenceKeys = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'Tab',
  'Escape', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'ShiftLeft', 'ShiftRight'
])

const SHIFT_KEYS: Record<string, { key: string; code: string; windowsVirtualKeyCode: number; location: number }> = {
  ShiftLeft: { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, location: 1 },
  ShiftRight: { key: 'Shift', code: 'ShiftRight', windowsVirtualKeyCode: 16, location: 2 }
}

/**
 * The one name of a key, so a key named by its character and by its KeyboardEvent.code is the same key: Shift is the
 * left Shift, KeyD is d and Digit1 is 1. Pages that read event.code, as most games do, then get the code they expect.
 */
export function sequenceKey(key: string): string {
  if (key === 'Shift') return 'ShiftLeft'
  const letter = /^Key([A-Z])$/.exec(key)
  if (letter) return letter[1]!.toLowerCase()
  const digit = /^Digit([0-9])$/.exec(key)
  return digit ? digit[1]! : key
}

const isShiftKey = (key: string): boolean => sequenceKey(key) in SHIFT_KEYS

/** An event acknowledged later than this after it was due moves the rest of the schedule, so the planned gaps stay. */
export const KEY_SEQUENCE_SHIFT_AFTER_MS = 17

export const MAX_KEY_SEQUENCE_EVENTS = 200
export const MAX_KEY_SEQUENCE_MS = 10_000

const keySequenceEvent = z.object({
  atMs: z.number().int().min(0).max(MAX_KEY_SEQUENCE_MS),
  type: z.enum(['down', 'up']),
  key: z.string().max(16).refine(key => /^[a-z0-9]$/.test(sequenceKey(key)) || namedSequenceKeys.has(sequenceKey(key)),
    'Use one lowercase letter or digit, its code (KeyA, Digit1), Shift, ShiftLeft, ShiftRight or a supported named key')
}).strict()

export const nativeKeySequenceFields = {
  events: z.array(keySequenceEvent).min(1).max(MAX_KEY_SEQUENCE_EVENTS).superRefine((events, context) => {
    const held = new Set<string>()
    events.forEach((given, index) => {
      const event = { ...given, key: sequenceKey(given.key) }
      if (index > 0 && event.atMs < events[index - 1]!.atMs) {
        context.addIssue({ code: 'custom', path: [index, 'atMs'], message: 'Event times must not decrease' })
      }
      if (event.type === 'down' && held.has(event.key)) {
        context.addIssue({ code: 'custom', path: [index], message: `${given.key} is already down; release it first` })
      }
      if (event.type === 'up' && !held.has(event.key)) {
        context.addIssue({ code: 'custom', path: [index], message: `${given.key} is not down` })
      }
      if (event.type === 'down') held.add(event.key)
      else held.delete(event.key)
    })
    if (held.size > 0) context.addIssue({ code: 'custom', message: `Release every key by the end: ${[...held].join(', ')}` })
  })
}
export const nativeKeySequenceInput = z.object({ tabId: z.string().min(1), ...nativeKeySequenceFields }).strict()
export type NativeKeySequenceInput = z.infer<typeof nativeKeySequenceInput>
type KeySequenceEvent = NativeKeySequenceInput['events'][number]

/**
 * The raw CDP command for one event, given the Shift keys already down. The shift modifier is set on every key event
 * while either Shift is down, and on a Shift's own down, as a keyboard does; the other keys go down raw, without text,
 * as for browser_hold_key.
 */
export function keySequenceCommand(event: Pick<KeySequenceEvent, 'type' | 'key'>, shiftsDown: ReadonlySet<string>): Record<string, unknown> {
  const type = event.type === 'down' ? 'rawKeyDown' : 'keyUp'
  const key = sequenceKey(event.key)
  const shift = SHIFT_KEYS[key]
  if (shift) {
    const otherShiftDown = [...shiftsDown].some(code => code !== key)
    return { type, ...shift, modifiers: event.type === 'down' || otherShiftDown ? 8 : 0 }
  }
  const shiftDown = shiftsDown.size > 0
  const description = nativeKeyDescription(parseBrowserKeyPress(shiftDown ? `Shift+${key}` : key))
  return { type, key: description.key, code: description.code, windowsVirtualKeyCode: description.virtualKeyCode, modifiers: shiftDown ? 8 : 0 }
}

/** The offset of each event from the first, which goes out at once: atMs counts from the first event, not from 0. */
export function keySequenceOffsetsMs(events: readonly Pick<KeySequenceEvent, 'atMs'>[]): number[] {
  const firstAtMs = events[0]?.atMs ?? 0
  return events.map(event => event.atMs - firstAtMs)
}

/**
 * How far the schedule has moved once the page acknowledged an event due at plannedAtMs, both in milliseconds from the
 * first event. An acknowledgement more than KEY_SEQUENCE_SHIFT_AFTER_MS after the event was due moves the rest of the
 * schedule by all of that lateness, a late timer wake included, so the page gets the planned gaps instead of the events
 * due meanwhile all at once. A page that moves the schedule by over MAX_KEY_SEQUENCE_MS in all stops the sequence, which
 * holds the tab's debugger until it ends.
 */
export function movedScheduleShiftMs(shiftMs: number, plannedAtMs: number, acknowledgedAtMs: number): number {
  const lateMs = acknowledgedAtMs - plannedAtMs
  if (lateMs <= KEY_SEQUENCE_SHIFT_AFTER_MS) return shiftMs
  if (shiftMs + lateMs > MAX_KEY_SEQUENCE_MS) throw new Error('The page delayed the key sequence by over 10 s; inspect fresh state')
  return shiftMs + lateMs
}

/** A key whose down a sequence attempted and whose up the page has not acknowledged, with whether its up was attempted. */
export interface HeldSequenceKey { key: string; upAttempted: boolean }

/**
 * The keys a sequence holds, by code, from the raw commands it attempted and the page acknowledged, with the progress a
 * hold reports. Both acknowledgements follow every attempt as well as every acknowledgement, so a down attempted after
 * earlier keys were released leaves the downs and the release unacknowledged until the page acknowledges that key too.
 */
export function keySequenceKeys(): {
  progress: NativeKeyHoldProgress
  held: Map<string, HeldSequenceKey>
  attempted: (params: Record<string, unknown>, key: string) => void
  acknowledged: (params: Record<string, unknown>) => void
  notReleased: (code: string, key: string) => void
} {
  const progress: NativeKeyHoldProgress = {
    downAttempted: false, downAcknowledged: false, releaseStarted: false, releaseAttempted: false, releaseAcknowledged: false
  }
  const held = new Map<string, HeldSequenceKey>()
  let unacknowledgedDowns = 0
  const settle = (): void => {
    progress.downAcknowledged = progress.downAttempted && unacknowledgedDowns === 0
    progress.releaseAcknowledged = progress.downAttempted && held.size === 0
  }
  return {
    progress,
    held,
    attempted: (params, key) => {
      const code = String(params.code)
      if (params.type === 'keyUp') {
        progress.releaseAttempted = true
        const state = held.get(code)
        if (state) state.upAttempted = true
      } else {
        progress.downAttempted = true
        unacknowledgedDowns += 1
        held.set(code, { key, upAttempted: false })
      }
      settle()
    },
    acknowledged: params => {
      if (params.type === 'keyUp') held.delete(String(params.code))
      else unacknowledgedDowns -= 1
      settle()
    },
    // A key-up the page acknowledged while a dialog held it, which Chromium dropped: the key is still down.
    notReleased: (code, key) => {
      held.set(code, { key, upAttempted: true })
      settle()
    }
  }
}

const shiftLast = (left: string, right: string): number => Number(isShiftKey(left)) - Number(isShiftKey(right))

/** Whether a website dialog or the print dialog holds the page: Chromium drops input sent meanwhile and acknowledges it at once. */
const dialogHolds = (page: object): boolean => websiteDialogHolds(page) || printDialogHolds(page)

/** The next turn of the event loop, in which the dialog guards decide whether a dialog the page just reported holds it. */
const nextTurn = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

/**
 * Releases the keys a sequence left down while a website dialog or the print dialog held its page, once that dialog closes:
 * Chromium drops input while a dialog shows, so the sequence sent those keys no key-up then and left its release unconfirmed.
 * Each key gets one key-up, other keys before Shift, through the same authorized input path as the sequence's own release
 * and, as there, without the call's checks, only while the tab still shows the same awake, active page. Resolves true when
 * the page acknowledged every key-up and no dialog holds it after them.
 */
async function releaseKeysAfterDialogs(browser: Browser, tab: BrowserTab, keys: readonly string[]): Promise<boolean> {
  const webContents = tab.webContents
  await whenWebsiteDialogCloses(webContents)
  await whenPrintDialogCloses(webContents)
  const releasable = (): boolean => !browser.destroyed && browser.tabs.get(tab.id) === tab && tab.webContents === webContents
    && !webContents.isDestroyed() && !tab.sleeping && tab.pageLifecycleState === 'active' && !dialogHolds(webContents)
  if (!releasable()) return false
  return withAgentInput(browser, webContents, () => withDebugger(browser, webContents, async () => {
    const shiftsDown = new Set(keys.filter(isShiftKey).map(sequenceKey))
    let acknowledged = true
    for (const key of [...keys].sort(shiftLast)) {
      if (!releasable()) return false
      const command = keySequenceCommand({ type: 'up', key }, shiftsDown)
      await sendAuthorizedAgentInputCommand(browser, webContents, 'Input.dispatchKeyEvent', command).catch(() => { acknowledged = false })
      shiftsDown.delete(sequenceKey(key))
      await nextTurn()
    }
    return acknowledged && releasable()
  }))
}

/**
 * Plays timed key downs and ups on the active, visible, awake page outside split view, each at its offset from the
 * first event, and reports when each was sent. It keeps the rules of browser_hold_key: any change to that environment,
 * the person's input or lock, a pause or lost authority stops the sequence before its next event and releases every key
 * still down, once; a failure after a key went down leaves the outcome unknown and is never replayed, and an unconfirmed
 * release blocks further holds and sequences on that page. A website dialog or the print dialog that holds the page
 * stops it too, and the keys it left down are released once that dialog closes.
 */
export async function playKeySequence(browser: Browser, input: NativeKeySequenceInput, validateInput: (validateContext: () => void) => void,
  recordProgress: (progress: NativeKeyHoldProgress) => void, signal?: AbortSignal): Promise<unknown> {
  const options = nativeKeySequenceInput.parse(input)
  const tab = getTab(browser, options.tabId)
  const webContents = tab.webContents
  if (browser.activeNativeKeyHolds.has(webContents)) throw new Error('A key hold or sequence is already active for this page')
  if (browser.unconfirmedNativeKeyHolds.has(webContents)) {
    throw new Error('Earlier key release is unconfirmed; close this tab before another sequence. '
      + 'Navigation does not establish release.')
  }
  const generation = tab.nativeInputEnvironmentGeneration
  const selectionGeneration = browser.tabSelectionGeneration
  const splitGeneration = browser.splitViewGeneration
  const authority = nativeInputAuthority(browser, tab, validateInput)
  const keys = keySequenceKeys()
  const progress = keys.progress
  const publish = (): void => { recordProgress({ ...progress }) }
  let environmentChanged = false
  const changed = (): void => { environmentChanged = true }
  const validate = (): void => {
    authority.validate()
    browser.requireEmulationConfirmed(tab)
    if (signal?.aborted) throw new Error('Key sequence cancelled')
    if (environmentChanged || generation !== tab.nativeInputEnvironmentGeneration
      || selectionGeneration !== browser.tabSelectionGeneration || splitGeneration !== browser.splitViewGeneration
      || inputLockChanging(browser, tab)) throw new Error('Key sequence environment changed; inspect fresh state')
    if (browser.activeTabId !== tab.id || browser.splitView || browser.browserContentOccluded
      || !browser.window.isVisible() || browser.window.isMinimized() || !tab.view.getVisible()
      || !browser.window.contentView.children.includes(tab.view) || tab.sleeping || tab.pageLifecycleState !== 'active') {
      throw new Error('Key sequence requires the active visible, already awake page outside split view')
    }
    if (browser.screenshotAreaSessions.has(webContents.id) || browser.elementPickerSessions.has(webContents.id)
      || browser.devToolsOpening.has(webContents.id) || webContents.isDevToolsOpened()
      || webContents.mainFrame.framesInSubtree.length !== 1) throw new Error('Key sequence does not support selections, Developer Tools or child frames')
    if (dialogHolds(webContents)) throw new Error('A website dialog or the print dialog holds the page; answer it, then inspect fresh state')
  }
  let sendingKey = ''
  // Set while an event is sent, and called once as its raw command is attempted.
  let onEventAttempted: (() => void) | undefined
  // Every raw command passes here, also the matching release the input barrier sends on its own when it cannot
  // lock a locked page again after a down.
  const observer: NativeInputDispatchObserver = {
    rawAttempted: params => {
      const attempted = onEventAttempted
      onEventAttempted = undefined
      attempted?.()
      keys.attempted(params, sendingKey)
      publish()
    },
    rawAcknowledged: params => { keys.acknowledged(params); publish() },
    emergencyReleaseStarted: () => { progress.releaseStarted = true; publish() }
  }
  const shiftsDown = new Set<string>()
  // Sends one event, then waits a turn, in which the dialog guards decide whether a dialog the page reported meanwhile
  // holds it. Chromium drops input sent while a dialog shows and acknowledges it at once, so a key-up then is no release.
  const send = async (event: Pick<KeySequenceEvent, 'type' | 'key'>, check: (() => void) | undefined, onAttempted?: () => void): Promise<void> => {
    const command = keySequenceCommand(event, shiftsDown)
    sendingKey = event.key
    onEventAttempted = onAttempted
    try {
      await sendAuthorizedAgentInputCommand(browser, webContents, 'Input.dispatchKeyEvent', command, check, observer)
    } finally {
      onEventAttempted = undefined
      await nextTurn()
    }
    if (isShiftKey(event.key)) {
      if (event.type === 'down') shiftsDown.add(sequenceKey(event.key))
      else shiftsDown.delete(sequenceKey(event.key))
    }
    if (event.type === 'up' && dialogHolds(webContents)) {
      keys.notReleased(String(command.code), event.key)
      publish()
    }
  }
  const offsetsMs = keySequenceOffsetsMs(options.events)
  const sentAtMs: number[] = []
  const plannedAtMs: number[] = []
  let scheduleShiftMs = 0
  let start = 0
  let startEpochMs = 0
  let releaseWaitsForDialog = false
  browser.activeNativeKeyHolds.add(webContents)
  tab.view.on('bounds-changed', changed)
  webContents.on('frame-created', changed)
  webContents.on('devtools-opened', changed)
  webContents.debugger.on('detach', changed)
  browser.window.on('hide', changed)
  browser.window.on('minimize', changed)
  try {
    validate()
    await withAgentInput(browser, webContents, () => withDebugger(browser, webContents, async () => {
      try {
        validate()
        // The schedule starts as the first event's raw command goes out, so that event is sent at once and the offsets count
        // from it. A page slow to handle an event, such as a game starting its run on the first key, or a timer that wakes
        // late would otherwise give the page the events due meanwhile all at once; the rest of the schedule moves instead.
        for (const [index, event] of options.events.entries()) {
          const plannedMs = offsetsMs[index]! + scheduleShiftMs
          if (index > 0) await waitForNativeKeyHold(start + plannedMs, validate, signal)
          await send(event, validate, () => {
            const now = performance.now()
            if (index === 0) {
              start = now
              startEpochMs = Date.now()
            }
            sentAtMs.push(Math.round(now - start))
            plannedAtMs.push(Math.round(plannedMs))
          })
          // Only the events still to come move, so the last one's lateness moves nothing.
          if (index + 1 < options.events.length) {
            scheduleShiftMs = movedScheduleShiftMs(scheduleShiftMs, plannedMs, performance.now() - start)
          }
        }
      } finally {
        // Release every key still down, Shift last, at most once each and never one whose up was already attempted. While a
        // dialog holds the page its key-ups would be dropped, so the keys left then are released once it closes.
        const pending = [...keys.held.values()].filter(state => !state.upAttempted).map(state => state.key).sort(shiftLast)
        if (pending.length > 0 && !dialogHolds(webContents)) {
          progress.releaseStarted = true
          publish()
        }
        for (const pendingKey of pending) {
          if (dialogHolds(webContents)) break
          await send({ type: 'up', key: pendingKey }, undefined).catch(() => undefined)
        }
        releaseWaitsForDialog = dialogHolds(webContents)
      }
    }))
    validate()
    // Lateness is against the moved schedule, which is what the page saw between events; scheduleShiftMs is how far it moved.
    const lateMs = sentAtMs.map((sent, index) => sent - plannedAtMs[index]!)
    return {
      status: 'DISPATCH_ACKNOWLEDGED',
      events: options.events.length,
      startEpochMs,
      durationMs: sentAtMs[sentAtMs.length - 1],
      sentAtMs,
      maxLateMs: Math.max(0, ...lateMs),
      scheduleShiftMs: Math.round(scheduleShiftMs),
      release: 'ACKNOWLEDGED'
    }
  } catch (error) {
    if (progress.downAttempted) throw new NativeKeyHoldOutcomeUnknownError(error, { ...progress })
    throw error
  } finally {
    if (progress.downAttempted && !progress.releaseAcknowledged && !webContents.isDestroyed()) {
      const forget = (): void => { browser.unconfirmedNativeKeyHolds.delete(webContents) }
      browser.unconfirmedNativeKeyHolds.add(webContents)
      webContents.once('destroyed', forget)
      if (releaseWaitsForDialog) {
        void releaseKeysAfterDialogs(browser, tab, [...keys.held.values()].map(state => state.key)).then(released => {
          if (!released || webContents.isDestroyed()) return
          webContents.removeListener('destroyed', forget)
          forget()
        }).catch(() => undefined)
      }
    }
    // The window and view first: a page destroyed meanwhile throws on reading its debugger.
    browser.window.removeListener('hide', changed)
    browser.window.removeListener('minimize', changed)
    tab.view.removeListener('bounds-changed', changed)
    browser.activeNativeKeyHolds.delete(webContents)
    authority.dispose()
    if (!webContents.isDestroyed()) {
      webContents.removeListener('frame-created', changed)
      webContents.removeListener('devtools-opened', changed)
      webContents.debugger.removeListener('detach', changed)
    }
  }
}
