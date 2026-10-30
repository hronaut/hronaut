import { parseBrowserKeyPress } from '../../../shared/keyboard-input.js'
import {
  nativeHeldKeyCommands,
  nativeKeyHoldInput,
  NativeKeyHoldOutcomeUnknownError,
  waitForNativeKeyHold,
  type NativeInputDispatchObserver,
  type NativeKeyHoldInput,
  type NativeKeyHoldProgress
} from '../native-key-hold.js'
import { dispatchNativeKeyPress } from '../native-keyboard.js'
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

/** Presses a key or key combination on the tab's page as native input while the agent's input stays authorized. */
export async function press(browser: Browser, key: string, tabId?: string, validateInput?: (validateContext: () => void) => void): Promise<void> {
  const tab = getTab(browser, tabId)
  const webContents = tab.webContents
  const input = parseBrowserKeyPress(key)
  const authority = nativeInputAuthority(browser, tab, validateInput)
  try {
    await withAgentInput(browser, webContents, () => withDebugger(
      browser,
      webContents,
      () => dispatchNativeKeyPress(agentInputDebugger(browser, webContents, authority.validate), input, agentInputDebugger(browser, webContents))
    ))
    // No check once the key is up, as after a click: a key that submits a form or follows a link navigates the page,
    // and that is the press working, not the page changing under it.
  } finally { authority.dispose() }
}
