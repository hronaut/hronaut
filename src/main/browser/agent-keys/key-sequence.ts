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

/**
 * Keys a sequence may hold: the keys browser_hold_key holds, without Insert, whose Shift chord pastes the person's
 * clipboard, plus Shift, the one modifier, which games use to run or dash. Control, Alt and Meta stay out, so a
 * sequence never presses a browser or system shortcut.
 */
const namedSequenceKeys = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'Tab',
  'Escape', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Shift'
])

export const MAX_KEY_SEQUENCE_EVENTS = 200
export const MAX_KEY_SEQUENCE_MS = 10_000

const keySequenceEvent = z.object({
  atMs: z.number().int().min(0).max(MAX_KEY_SEQUENCE_MS),
  type: z.enum(['down', 'up']),
  key: z.string().max(16).refine(key => /^[a-z0-9]$/.test(key) || namedSequenceKeys.has(key),
    'Use one lowercase letter, digit, Shift or supported named key')
}).strict()

export const nativeKeySequenceFields = {
  events: z.array(keySequenceEvent).min(1).max(MAX_KEY_SEQUENCE_EVENTS).superRefine((events, context) => {
    const held = new Set<string>()
    events.forEach((event, index) => {
      if (index > 0 && event.atMs < events[index - 1]!.atMs) {
        context.addIssue({ code: 'custom', path: [index, 'atMs'], message: 'Event times must not decrease' })
      }
      if (event.type === 'down' && held.has(event.key)) {
        context.addIssue({ code: 'custom', path: [index], message: `${event.key} is already down; release it first` })
      }
      if (event.type === 'up' && !held.has(event.key)) {
        context.addIssue({ code: 'custom', path: [index], message: `${event.key} is not down` })
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

const SHIFT = { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, location: 1 }

/**
 * The raw CDP command for one event. Shift sets the shift modifier on every key event while it is down, and on its own
 * down, as a keyboard does; the other keys go down raw, without text, as for browser_hold_key.
 */
export function keySequenceCommand(event: Pick<KeySequenceEvent, 'type' | 'key'>, shiftDown: boolean): Record<string, unknown> {
  const type = event.type === 'down' ? 'rawKeyDown' : 'keyUp'
  if (event.key === 'Shift') return { type, ...SHIFT, modifiers: event.type === 'down' ? 8 : 0 }
  const description = nativeKeyDescription(parseBrowserKeyPress(shiftDown ? `Shift+${event.key}` : event.key))
  return { type, key: description.key, code: description.code, windowsVirtualKeyCode: description.virtualKeyCode, modifiers: shiftDown ? 8 : 0 }
}

/**
 * Plays timed key downs and ups on the active, visible, awake page outside split view, each at its offset from the
 * first event, and reports when each was sent. It keeps the rules of browser_hold_key: any change to that environment,
 * the person's input or lock, a pause or lost authority stops the sequence before its next event and releases every key
 * still down, once; a failure after a key went down leaves the outcome unknown and is never replayed, and an unconfirmed
 * release blocks further holds and sequences on that page.
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
  const progress: NativeKeyHoldProgress = {
    downAttempted: false, downAcknowledged: false, releaseStarted: false, releaseAttempted: false, releaseAcknowledged: false
  }
  const publish = (): void => { recordProgress({ ...progress }) }
  // Keys whose down was attempted and whose up was not acknowledged, by code, with whether their up was attempted.
  const held = new Map<string, { key: string; upAttempted: boolean }>()
  let unacknowledgedDowns = 0
  let environmentChanged = false
  const changed = (): void => { environmentChanged = true }
  const validate = (): void => {
    authority.validate()
    browser.requireEmulationConfirmed(tab)
    if (signal?.aborted) throw new Error('Key sequence cancelled')
    if (environmentChanged || generation !== tab.nativeInputEnvironmentGeneration
      || selectionGeneration !== browser.tabSelectionGeneration || splitGeneration !== browser.splitViewGeneration
      || browser.nativeInputLockMutations > 0) throw new Error('Key sequence environment changed; inspect fresh state')
    if (browser.activeTabId !== tab.id || browser.splitView || browser.browserContentOccluded
      || !browser.window.isVisible() || browser.window.isMinimized() || !tab.view.getVisible()
      || !browser.window.contentView.children.includes(tab.view) || tab.sleeping || tab.pageLifecycleState !== 'active') {
      throw new Error('Key sequence requires the active visible, already awake page outside split view')
    }
    if (browser.screenshotAreaSessions.has(webContents.id) || browser.elementPickerSessions.has(webContents.id)
      || browser.devToolsOpening.has(webContents.id) || webContents.isDevToolsOpened()
      || webContents.mainFrame.framesInSubtree.length !== 1) throw new Error('Key sequence does not support selections, Developer Tools or child frames')
  }
  let sendingKey = ''
  // Every raw command passes here, also the matching release the input barrier sends on its own when it cannot
  // lock a locked page again after a down.
  const observer: NativeInputDispatchObserver = {
    rawAttempted: params => {
      const code = String(params.code)
      if (params.type === 'keyUp') {
        progress.releaseAttempted = true
        const state = held.get(code)
        if (state) state.upAttempted = true
      } else {
        progress.downAttempted = true
        unacknowledgedDowns += 1
        held.set(code, { key: sendingKey, upAttempted: false })
      }
      publish()
    },
    rawAcknowledged: params => {
      if (params.type === 'keyUp') held.delete(String(params.code))
      else unacknowledgedDowns -= 1
      progress.downAcknowledged = unacknowledgedDowns === 0
      progress.releaseAcknowledged = held.size === 0
      publish()
    },
    emergencyReleaseStarted: () => { progress.releaseStarted = true; publish() }
  }
  const sentAtMs: number[] = []
  let shiftDown = false
  let startEpochMs = 0
  const send = async (event: Pick<KeySequenceEvent, 'type' | 'key'>, check: (() => void) | undefined): Promise<void> => {
    sendingKey = event.key
    await sendAuthorizedAgentInputCommand(browser, webContents, 'Input.dispatchKeyEvent', keySequenceCommand(event, shiftDown), check, observer)
    if (event.key === 'Shift') shiftDown = event.type === 'down'
  }
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
        const start = performance.now()
        startEpochMs = Date.now()
        for (const event of options.events) {
          await waitForNativeKeyHold(start + event.atMs, validate, signal)
          sentAtMs.push(Math.round(performance.now() - start))
          await send(event, validate)
        }
      } finally {
        // Release every key still down, Shift last, at most once each and never one whose up was already attempted.
        const pending = [...held.values()].filter(state => !state.upAttempted).map(state => state.key)
          .sort((left, right) => Number(left === 'Shift') - Number(right === 'Shift'))
        if (pending.length > 0) {
          progress.releaseStarted = true
          publish()
          for (const pendingKey of pending) await send({ type: 'up', key: pendingKey }, undefined).catch(() => undefined)
        }
      }
    }))
    validate()
    const lateMs = options.events.map((event, index) => sentAtMs[index]! - event.atMs)
    return {
      status: 'DISPATCH_ACKNOWLEDGED',
      events: options.events.length,
      startEpochMs,
      durationMs: sentAtMs[sentAtMs.length - 1],
      sentAtMs,
      maxLateMs: Math.max(0, ...lateMs),
      release: 'ACKNOWLEDGED'
    }
  } catch (error) {
    if (progress.downAttempted) throw new NativeKeyHoldOutcomeUnknownError(error, { ...progress })
    throw error
  } finally {
    if (progress.downAttempted && !progress.releaseAcknowledged && !webContents.isDestroyed()) {
      browser.unconfirmedNativeKeyHolds.add(webContents)
      webContents.once('destroyed', () => { browser.unconfirmedNativeKeyHolds.delete(webContents) })
    }
    browser.activeNativeKeyHolds.delete(webContents)
    authority.dispose()
    tab.view.removeListener('bounds-changed', changed)
    webContents.removeListener('frame-created', changed)
    webContents.removeListener('devtools-opened', changed)
    webContents.debugger.removeListener('detach', changed)
    browser.window.removeListener('hide', changed)
    browser.window.removeListener('minimize', changed)
  }
}
