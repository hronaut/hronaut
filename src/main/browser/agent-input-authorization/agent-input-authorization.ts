import type { WebContents } from 'electron'
import type { NativeInputDispatchObserver } from '../native-key-hold.js'
import type { KeyboardDebugger } from '../native-keyboard.js'
import { matchingNativeInputRelease, NativeInputCleanupError } from '../native-input-cleanup.js'
import type { PointerDebugger } from '../native-pointer.js'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'

/**
 * The one mouse event an agent's native input command is about to produce, in
 * Electron's terms, so the page's input guard admits exactly that event while
 * the person's input is locked.
 */
export interface AuthorizedAgentMouseInput {
  type: Electron.MouseInputEvent['type']
  x: number
  y: number
  button: Electron.MouseInputEvent['button'] | undefined
  buttons: number
  clickCount: number
  modifiers: number
}

/**
 * The one key event an agent's native input command is about to produce, in
 * Electron's terms, so the page's input guard admits exactly that event.
 */
export interface AuthorizedAgentKeyboardInput {
  type: Electron.Input['type']
  key: string
  code: string
  modifiers: number
  autoRepeat: boolean
}

/**
 * Whether the page's input guard blocks this mouse event: the person's input
 * to the tab is locked and the event is not the one an agent's command is
 * producing, which it admits once.
 */
export function shouldBlockHumanMouseInput(browser: Browser, tab: BrowserTab, mouse: Electron.MouseInputEvent): boolean {
  return browser.isHumanInteractionLocked(tab)
    && !isAuthorizedAgentMouseInput(browser, tab.webContents.id, mouse)
}

/**
 * A debugger for native pointer and keyboard helpers that sends each input
 * command through the authorized agent input path, checking the caller's
 * context first when given.
 */
export function agentInputDebugger(
  browser: Browser,
  webContents: WebContents,
  validateInput?: () => void
): PointerDebugger & KeyboardDebugger {
  return {
    sendCommand: (method, commandParams) => sendAuthorizedAgentInputCommand(
      browser,
      webContents,
      method,
      commandParams,
      validateInput
    )
  }
}

/**
 * Sends one native input command for an agent. While the person's input to
 * the tab is locked it lifts the compositor barrier for this event only and
 * records the expected event so the input guard admits just that one; the
 * context is checked again right before dispatch. When restoring the barrier
 * fails after dispatch, it sends one matching release and reports the cleanup
 * failure.
 */
export async function sendAuthorizedAgentInputCommand(
  browser: Browser,
  webContents: WebContents,
  method: string,
  commandParams: Record<string, unknown> = {},
  validateInput?: () => void,
  observer?: NativeInputDispatchObserver,
  beforeRawDispatch?: () => Promise<void>
): Promise<unknown> {
  validateInput?.()
  const mouse = method === 'Input.dispatchMouseEvent'
    ? authorizedMouseInputFromCommand(commandParams)
    : null
  const keyboard = method === 'Input.dispatchKeyEvent'
    ? authorizedKeyboardInputFromCommand(commandParams)
    : null
  const tabId = browser.webContentsToTab.get(webContents.id)
  const tab = tabId ? findTab(browser, tabId) : undefined
  const temporarilyPermitNativeInput = Boolean((mouse || keyboard) && tab && browser.isHumanInteractionLocked(tab))
  if (temporarilyPermitNativeInput) {
    await webContents.debugger.sendCommand('Input.setIgnoreInputEvents', { ignore: false })
  }
  let rawDispatched = false
  try {
    // Semantic-click sampling uses this already-acquired debugger after the
    // barrier lift. Matching releases never receive an admission hook.
    if (beforeRawDispatch) await beforeRawDispatch()
    // Recheck after lifting the compositor barrier, immediately before input.
    validateInput?.()
    if (mouse) browser.authorizedAgentMouseInput.set(webContents.id, mouse)
    if (keyboard) browser.authorizedAgentKeyboardInput.set(webContents.id, keyboard)
    observer?.rawAttempted(commandParams)
    const result = await webContents.debugger.sendCommand(method, commandParams)
    rawDispatched = true
    observer?.rawAcknowledged(commandParams)
    return result
  } finally {
    if (mouse && browser.authorizedAgentMouseInput.get(webContents.id) === mouse) {
      browser.authorizedAgentMouseInput.delete(webContents.id)
    }
    if (keyboard && browser.authorizedAgentKeyboardInput.get(webContents.id) === keyboard) {
      browser.authorizedAgentKeyboardInput.delete(webContents.id)
    }
    if (temporarilyPermitNativeInput && !webContents.isDestroyed()) {
      // Lift the compositor barrier for this single CDP event only. The
      // before-input guards remain active and admit only the matching event;
      // physical wheel/gesture input and mismatched event shapes stay blocked.
      try {
        await webContents.debugger.sendCommand('Input.setIgnoreInputEvents', { ignore: true })
      } catch (error) {
        observer?.cleanupFailed?.()
        if (!rawDispatched) throw error
        const release = matchingNativeInputRelease(method, commandParams)
        if (release) {
          // The caller will see a rejection and cannot know that down succeeded.
          // Send one matching release through the same native input guard. Up
          // events cannot recurse into another release, even if re-lock fails.
          observer?.emergencyReleaseStarted()
          await sendAuthorizedAgentInputCommand(browser, webContents, method, release, undefined, observer).catch(() => undefined)
        }
        throw new NativeInputCleanupError(error)
      }
    }
  }
}

/** The Electron mouse event a CDP mouse command produces, or null when the command is not a well-formed one. */
function authorizedMouseInputFromCommand(
  commandParams: Record<string, unknown>
): AuthorizedAgentMouseInput | null {
  const type = {
    mouseMoved: 'mouseMove',
    mousePressed: 'mouseDown',
    mouseReleased: 'mouseUp',
    mouseWheel: 'mouseWheel'
  }[String(commandParams.type)] as Electron.MouseInputEvent['type'] | undefined
  const x = Number(commandParams.x)
  const y = Number(commandParams.y)
  if (!type || !Number.isFinite(x) || !Number.isFinite(y)) return null
  const buttonValue = typeof commandParams.button === 'string' ? commandParams.button : undefined
  const button = buttonValue === 'left' || buttonValue === 'middle' || buttonValue === 'right'
    ? buttonValue
    : undefined
  const postEventButtons = Number(commandParams.buttons ?? 0)
  const clickCount = Number(commandParams.clickCount ?? 0)
  const modifiers = Number(commandParams.modifiers ?? 0)
  if (
    !Number.isInteger(postEventButtons)
    || postEventButtons < 0
    || postEventButtons > 7
    || !Number.isInteger(clickCount)
    || clickCount < 0
    || !Number.isInteger(modifiers)
  ) return null
  const changedButton = button === 'left' ? 1 : button === 'right' ? 2 : button === 'middle' ? 4 : 0
  // CDP reports the complete button mask. Electron reports independently
  // held buttons in modifiers while exposing the button changed by down/up
  // separately, so remove that changed button before comparing the masks.
  const buttons = type === 'mouseDown' || type === 'mouseUp'
    ? postEventButtons & ~changedButton
    : postEventButtons
  return {
    type,
    x,
    y,
    button,
    buttons,
    clickCount,
    modifiers
  }
}

/** The Electron key event a CDP key command produces, or null when the command is not a well-formed one. */
function authorizedKeyboardInputFromCommand(
  commandParams: Record<string, unknown>
): AuthorizedAgentKeyboardInput | null {
  const commandType = String(commandParams.type)
  const type = commandType === 'keyUp'
    ? 'keyUp'
    : commandType === 'rawKeyDown'
      ? 'rawKeyDown'
      : commandType === 'keyDown'
        ? 'keyDown'
        : null
  const key = typeof commandParams.key === 'string' ? commandParams.key : null
  const code = typeof commandParams.code === 'string' ? commandParams.code : null
  const modifiers = Number(commandParams.modifiers ?? 0)
  if (!type || !key || !code || !Number.isInteger(modifiers)) return null
  return { type, key, code, modifiers, autoRepeat: commandParams.autoRepeat === true }
}

/** Whether the mouse event is the one recorded for the page's agent command, consuming the record when it is. */
function isAuthorizedAgentMouseInput(
  browser: Browser,
  webContentsId: number,
  mouse: Electron.MouseInputEvent
): boolean {
  const expected = browser.authorizedAgentMouseInput.get(webContentsId)
  // Electron's before-mouse-event omits modifiers, which also carry the held
  // buttons, so a pressed drag move or a modifier click is compared on the
  // fields it does report. It reports a move with no button as 'none', which
  // the CDP command leaves out.
  const reported = mouse.modifiers !== undefined
  const button = (mouse.button as string | undefined) === 'none' ? undefined : mouse.button
  const matches = expected !== undefined
    && mouse.type === expected.type
    && Math.abs(mouse.x - expected.x) < 1
    && Math.abs(mouse.y - expected.y) < 1
    && button === expected.button
    && (!reported || electronButtonBits(mouse.modifiers) === expected.buttons)
    && (mouse.clickCount ?? 0) === expected.clickCount
    && (!reported || electronModifierBits(mouse.modifiers) === expected.modifiers)
  if (matches) browser.authorizedAgentMouseInput.delete(webContentsId)
  return matches
}

/** Whether the key event is the one recorded for the page's agent command, consuming the record when it is. */
export function consumeExpectedAgentKeyboardInput(
  browser: Browser,
  webContentsId: number,
  input: Electron.Input
): boolean {
  const expected = browser.authorizedAgentKeyboardInput.get(webContentsId)
  if (!expected) return false
  const inputModifierBits = electronModifierBits(input.modifiers)
  const compatibleType = input.type === expected.type
    || (expected.type === 'rawKeyDown' && input.type === 'keyDown')
  const matches = compatibleType
    && input.key === expected.key
    && input.code === expected.code
    && inputModifierBits === expected.modifiers
    && input.isAutoRepeat === expected.autoRepeat
  if (matches) browser.authorizedAgentKeyboardInput.delete(webContentsId)
  return matches
}

/** The CDP modifier mask (alt 1, control 2, meta 4, shift 8) of Electron's modifier names. */
function electronModifierBits(modifiers: readonly string[] | undefined): number {
  const values = new Set(modifiers ?? [])
  return (values.has('alt') ? 1 : 0)
    | (values.has('control') || values.has('ctrl') ? 2 : 0)
    | (values.has('meta') || values.has('command') || values.has('cmd') ? 4 : 0)
    | (values.has('shift') ? 8 : 0)
}

/** The CDP button mask (left 1, right 2, middle 4) of the buttons Electron reports held. */
function electronButtonBits(modifiers: readonly string[] | undefined): number {
  const values = new Set(modifiers ?? [])
  return (values.has('leftbuttondown') ? 1 : 0)
    | (values.has('rightbuttondown') ? 2 : 0)
    | (values.has('middlebuttondown') ? 4 : 0)
}
