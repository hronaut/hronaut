import { parseBrowserKeyPress, type BrowserKeyPress } from '../../../shared/keyboard-input.js'
import {
  nativeHeldKeyCommands,
  nativeKeyHoldInput,
  NativeKeyHoldOutcomeUnknownError,
  waitForNativeKeyHold,
  type NativeInputDispatchObserver,
  type NativeKeyHoldInput,
  type NativeKeyHoldProgress
} from '../native-key-hold.js'
import { dispatchNativeKeyPress, nativeKeyDescription } from '../native-keyboard.js'
import type { Browser } from '../browser.js'
import { agentInputDebugger, sendAuthorizedAgentInputCommand } from '../agent-input-authorization/agent-input-authorization.js'
import { getTab } from '../browser-core.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { withAgentInput } from '../agent-input-scope/agent-input-scope.js'
import { nativeInputAuthority } from '../native-input-authority/native-input-authority.js'

/**
 * Holds one key down on the active, visible, awake page outside split view
 * for the requested time, then releases it. Any change to that environment
 * while the key is held rejects the call and releases the key; a failure after
 * the key went down leaves the outcome unknown, and an unconfirmed release
 * blocks further holds on that page.
 */
export async function holdKey(browser: Browser, input: NativeKeyHoldInput, validateInput: (validateContext: () => void) => void,
  recordProgress: (progress: NativeKeyHoldProgress) => void, signal?: AbortSignal): Promise<unknown> {
  const options = nativeKeyHoldInput.parse(input)
  const tab = getTab(browser, options.tabId)
  const webContents = tab.webContents
  if (browser.activeNativeKeyHolds.has(webContents)) throw new Error('A key hold is already active for this page')
  if (browser.unconfirmedNativeKeyHolds.has(webContents)) throw new Error('Earlier key release is unconfirmed; close this tab before another hold. Navigation does not establish release.')
  const generation = tab.nativeInputEnvironmentGeneration
  const selectionGeneration = browser.tabSelectionGeneration
  const splitGeneration = browser.splitViewGeneration
  const authority = nativeInputAuthority(browser, tab, validateInput)
  const progress: NativeKeyHoldProgress = { downAttempted: false, downAcknowledged: false, releaseStarted: false, releaseAttempted: false, releaseAcknowledged: false }
  const publish = (): void => { recordProgress({ ...progress }) }
  const commands = nativeHeldKeyCommands(options.key)
  let started = 0
  let environmentChanged = false
  const changed = (): void => { environmentChanged = true }
  const validate = (): void => {
    authority.validate()
    browser.requireEmulationConfirmed(tab)
    if (signal?.aborted) throw new Error('Key hold cancelled')
    if (environmentChanged || generation !== tab.nativeInputEnvironmentGeneration
      || selectionGeneration !== browser.tabSelectionGeneration || splitGeneration !== browser.splitViewGeneration
      || browser.nativeInputLockMutations > 0) throw new Error('Key hold environment changed; inspect fresh state')
    if (browser.activeTabId !== tab.id || browser.splitView || browser.browserContentOccluded
      || !browser.window.isVisible() || browser.window.isMinimized() || !tab.view.getVisible()
      || !browser.window.contentView.children.includes(tab.view) || tab.sleeping || tab.pageLifecycleState !== 'active') {
      throw new Error('Key hold requires the active visible, already awake page outside split view')
    }
    if (browser.screenshotAreaSessions.has(webContents.id) || browser.elementPickerSessions.has(webContents.id)
      || browser.devToolsOpening.has(webContents.id) || webContents.isDevToolsOpened()
      || webContents.mainFrame.framesInSubtree.length !== 1) throw new Error('Key hold does not support selections, Developer Tools or child frames')
  }
  const observer: NativeInputDispatchObserver = {
    rawAttempted: params => {
      if (params.type === 'keyUp') progress.releaseAttempted = true
      else progress.downAttempted = true
      publish()
    },
    rawAcknowledged: params => {
      if (params.type === 'keyUp') progress.releaseAcknowledged = true
      else { progress.downAcknowledged = true; started = performance.now() }
      publish()
    },
    emergencyReleaseStarted: () => { progress.releaseStarted = true; publish() }
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
        await sendAuthorizedAgentInputCommand(browser, webContents, 'Input.dispatchKeyEvent', commands.down, validate, observer)
        await waitForNativeKeyHold(started + options.durationMs, validate, signal)
      } finally {
        if (progress.downAttempted && !progress.releaseStarted) {
          // Reserve the cleanup path before preparation, including failures
          // before a raw up command. Never retry an emergency release path.
          progress.releaseStarted = true
          publish()
          await sendAuthorizedAgentInputCommand(browser, webContents, 'Input.dispatchKeyEvent', commands.up, undefined, observer)
        }
      }
    }))
    validate()
    return { status: 'DISPATCH_ACKNOWLEDGED', key: options.key, durationMs: options.durationMs, release: 'ACKNOWLEDGED' }
  } catch (error) {
    if (progress.downAttempted) throw new NativeKeyHoldOutcomeUnknownError(error, { ...progress })
    throw error
  } finally {
    if (progress.downAttempted && !progress.releaseAcknowledged && !webContents.isDestroyed()) {
      browser.unconfirmedNativeKeyHolds.add(webContents)
      webContents.once('destroyed', () => { browser.unconfirmedNativeKeyHolds.delete(webContents) })
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

/**
 * Shift+F10 opens the page's context menu on Windows and Linux, as a right-click does, and Hronaut's menu would open
 * with it as the person's own, at their pointer and whatever tab they are on, where Paste gives the agent's page their
 * clipboard.
 */
function opensContextMenu(input: BrowserKeyPress): boolean {
  return process.platform !== 'darwin' && input.keyCode.toLowerCase() === 'f10' && input.modifiers.includes('shift')
}

/**
 * Chromium's paste keys, by key code and exactly these modifiers, as Chromium matches them; the Paste key itself is
 * refused with any modifiers, more widely than Chromium pastes with it. They paste the system clipboard, which is the
 * person's: an agent's paste gave its page what they had copied, such as a password, for the page and the agent to
 * read. Control+V and Control+Shift+V paste on Windows and Linux only; on macOS the app's menu pastes, which an agent's
 * key never reaches. Copy and cut keys stay, as a web terminal's Control+C does: a page can write the clipboard on any
 * click of the agent's anyway.
 */
const PASTE_KEYS: readonly { virtualKeyCode: number; modifiers: string; platforms?: 'not-darwin' }[] = [
  { virtualKeyCode: 45, modifiers: 'shift' }, // Shift+Insert
  { virtualKeyCode: 86, modifiers: 'control', platforms: 'not-darwin' }, // Control+V
  { virtualKeyCode: 86, modifiers: 'control+shift', platforms: 'not-darwin' } // Control+Shift+V
]

export const PASTE_KEY_REFUSAL = 'Paste keys would give the page the person\'s clipboard; use browser_insert_text to enter text'

/** Whether a key press would paste the person's clipboard, by its key or by the Paste key Chromium also pastes with. */
export function pastesClipboard(input: BrowserKeyPress, platform: NodeJS.Platform = process.platform): boolean {
  const key = nativeKeyDescription(input)
  if (key.key.toLowerCase() === 'paste') return true
  const modifiers = [...input.modifiers].sort().join('+')
  return PASTE_KEYS.some((paste) => paste.virtualKeyCode === key.virtualKeyCode && paste.modifiers === modifiers
    && (paste.platforms !== 'not-darwin' || platform !== 'darwin'))
}

/** Presses a key or key combination on the tab's page as native input while the agent's input stays authorized. */
export async function press(browser: Browser, key: string, tabId?: string, validateInput?: (validateContext: () => void) => void): Promise<void> {
  const tab = getTab(browser, tabId)
  const webContents = tab.webContents
  const input = parseBrowserKeyPress(key)
  if (pastesClipboard(input)) throw new Error(PASTE_KEY_REFUSAL)
  // As for a right-click, the page's own menu opens only in a page the person locked for the agent, which opens none of
  // Hronaut's. They may unlock it while the press waits for the page, so the key goes down only while it is still locked.
  const menuKey = opensContextMenu(input)
  const requireLocked = (): void => {
    if (!menuKey) return
    if (browser.nativeInputLockMutations > 0 || !browser.isHumanInteractionLocked(tab)) {
      throw new Error('Shift+F10 opens the context menu, which requires a page locked in the trusted UI')
    }
  }
  requireLocked()
  const authority = nativeInputAuthority(browser, tab, validateInput)
  const validate = (): void => {
    authority.validate()
    requireLocked()
  }
  try {
    await withAgentInput(browser, webContents, () => withDebugger(
      browser,
      webContents,
      () => dispatchNativeKeyPress(agentInputDebugger(browser, webContents, validate), input, agentInputDebugger(browser, webContents))
    ))
    // No check once the key is up, as after a click: a key that submits a form or follows a link navigates the page,
    // and that is the press working, not the page changing under it.
  } finally { authority.dispose() }
}
