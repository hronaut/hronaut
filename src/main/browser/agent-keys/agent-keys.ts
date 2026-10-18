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
import type { AgentKeysAccess, AgentKeysTab } from './agent-keys-access.js'

/**
 * Holds one key down on the active, visible, awake page outside split view
 * for the requested time, then releases it. Any change to that environment
 * while the key is held rejects the call and releases the key; a failure after
 * the key went down leaves the outcome unknown, and an unconfirmed release
 * blocks further holds on that page.
 */
export async function holdKey<Tab extends AgentKeysTab>(access: AgentKeysAccess<Tab>, input: NativeKeyHoldInput, validateInput: (validateContext: () => void) => void,
  recordProgress: (progress: NativeKeyHoldProgress) => void, signal?: AbortSignal): Promise<unknown> {
  const options = nativeKeyHoldInput.parse(input)
  const tab = access.getTab(options.tabId)
  const webContents = tab.webContents
  if (access.activeNativeKeyHolds().has(webContents)) throw new Error('A key hold is already active for this page')
  if (access.unconfirmedNativeKeyHolds().has(webContents)) throw new Error('Earlier key release is unconfirmed; close this tab before another hold. Navigation does not establish release.')
  const generation = tab.nativeInputEnvironmentGeneration
  const selectionGeneration = access.tabSelectionGeneration()
  const splitGeneration = access.splitViewGeneration()
  const authority = access.nativeInputAuthority(tab, validateInput)
  const progress: NativeKeyHoldProgress = { downAttempted: false, downAcknowledged: false, releaseStarted: false, releaseAttempted: false, releaseAcknowledged: false }
  const publish = (): void => { recordProgress({ ...progress }) }
  const commands = nativeHeldKeyCommands(options.key)
  let started = 0
  let environmentChanged = false
  const changed = (): void => { environmentChanged = true }
  const validate = (): void => {
    authority.validate()
    access.requireEmulationConfirmed(tab)
    if (signal?.aborted) throw new Error('Key hold cancelled')
    if (environmentChanged || generation !== tab.nativeInputEnvironmentGeneration
      || selectionGeneration !== access.tabSelectionGeneration() || splitGeneration !== access.splitViewGeneration()
      || access.nativeInputLockMutations() > 0) throw new Error('Key hold environment changed; inspect fresh state')
    if (access.activeTabId() !== tab.id || access.splitView() || access.browserContentOccluded()
      || !access.window().isVisible() || access.window().isMinimized() || !tab.view.getVisible()
      || !access.window().contentView.children.includes(tab.view) || tab.sleeping || tab.pageLifecycleState !== 'active') {
      throw new Error('Key hold requires the active visible, already awake page outside split view')
    }
    if (access.screenshotAreaSessions().has(webContents.id) || access.elementPickerSessions().has(webContents.id)
      || access.devToolsOpening().has(webContents.id) || webContents.isDevToolsOpened()
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
  access.activeNativeKeyHolds().add(webContents)
  tab.view.on('bounds-changed', changed)
  webContents.on('frame-created', changed)
  webContents.on('devtools-opened', changed)
  webContents.debugger.on('detach', changed)
  access.window().on('hide', changed)
  access.window().on('minimize', changed)
  try {
    validate()
    await access.withAgentInput(webContents, () => access.withDebugger(webContents, async () => {
      try {
        validate()
        await access.sendAuthorizedAgentInputCommand(webContents, 'Input.dispatchKeyEvent', commands.down, validate, observer)
        await waitForNativeKeyHold(started + options.durationMs, validate, signal)
      } finally {
        if (progress.downAttempted && !progress.releaseStarted) {
          // Reserve the cleanup path before preparation, including failures
          // before a raw up command. Never retry an emergency release path.
          progress.releaseStarted = true
          publish()
          await access.sendAuthorizedAgentInputCommand(webContents, 'Input.dispatchKeyEvent', commands.up, undefined, observer)
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
      access.unconfirmedNativeKeyHolds().add(webContents)
      webContents.once('destroyed', () => { access.unconfirmedNativeKeyHolds().delete(webContents) })
    }
    access.activeNativeKeyHolds().delete(webContents)
    authority.dispose()
    tab.view.removeListener('bounds-changed', changed)
    webContents.removeListener('frame-created', changed)
    webContents.removeListener('devtools-opened', changed)
    webContents.debugger.removeListener('detach', changed)
    access.window().removeListener('hide', changed)
    access.window().removeListener('minimize', changed)
  }
}

/** Presses a key or key combination on the tab's page as native input while the agent's input stays authorized. */
export async function press<Tab extends AgentKeysTab>(access: AgentKeysAccess<Tab>, key: string, tabId?: string, validateInput?: (validateContext: () => void) => void): Promise<void> {
  const tab = access.getTab(tabId)
  const webContents = tab.webContents
  const input = parseBrowserKeyPress(key)
  const authority = access.nativeInputAuthority(tab, validateInput)
  try {
    await access.withAgentInput(webContents, () => access.withDebugger(
      webContents,
      () => dispatchNativeKeyPress(access.agentInputDebugger(webContents, authority.validate), input, access.agentInputDebugger(webContents))
    ))
    authority.validate()
  } finally { authority.dispose() }
}
