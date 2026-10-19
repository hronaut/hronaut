import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { InteractionLockAccess, InteractionLockTab } from './interaction-lock-access.js'

/**
 * Waits briefly for the tabs' pending debugger commands and dialog monitor
 * attachments, and rejects without changing anything when a page stays busy.
 */
async function prepareInteractionLock<Tab extends InteractionLockTab>(access: InteractionLockAccess<Tab>, tabs: readonly Tab[]): Promise<void> {
  // Do not mutate lock state or enqueue guard writes behind an indefinitely
  // pending native command. A late queue completion cannot apply this request.
  const pending = tabs.flatMap(tab => [
    access.pendingDebuggerCommand(tab.webContents.id),
    access.dialogMonitorAttach(tab.webContents.id)
  ].filter((value): value is Promise<void> => value !== undefined))
  if (pending.length) {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        Promise.allSettled(pending),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new LocalizedError('appErrors.inputLock.pageBusy')), 2000)
        })
      ])
    } finally { if (timer) clearTimeout(timer) }
  }
}

/** Runs the lock change after every earlier one, and its rollback, has settled. */
function enqueueInteractionLockMutation<Tab extends InteractionLockTab>(access: InteractionLockAccess<Tab>, operation: () => Promise<BrowserState>): Promise<BrowserState> {
  const result = access.interactionLockTail().then(() => {
    if (access.isDestroyed()) throw new Error('Browser tabs manager has been destroyed')
    return operation()
  })
  // Keep each mutation and any rollback together across tab and global requests.
  access.writeInteractionLockTail(result.then(() => undefined, () => undefined))
  return result
}

/**
 * Locks or unlocks the person's input in a tab, as an exception to a global
 * lock when there is one. Changes run one at a time, and a failed native guard
 * update rolls the tab back.
 */
export function setTabHumanInteractionLocked<Tab extends InteractionLockTab>(access: InteractionLockAccess<Tab>, tabId: string, locked: boolean): Promise<BrowserState> {
  const tab = access.findTab(tabId)
  if (tab) tab.nativeInputEnvironmentGeneration += 1
  access.writeNativeInputLockMutations(access.nativeInputLockMutations() + 1)
  return enqueueInteractionLockMutation(access, () => applyTabHumanInteractionLocked(access, tabId, locked))
    .finally(() => { access.writeNativeInputLockMutations(access.nativeInputLockMutations() - 1) })
}

/**
 * Applies a tab's lock change once its page is idle. A public observer
 * workspace's pages stay locked, and locking closes Developer Tools.
 */
async function applyTabHumanInteractionLocked<Tab extends InteractionLockTab>(access: InteractionLockAccess<Tab>, tabId: string, locked: boolean): Promise<BrowserState> {
  const tab = access.getTab(tabId)
  if (!locked && tab.mcpGroupId && access.findWorkspace(tab.mcpGroupId)?.contextClass === 'public-observer') {
    throw new LocalizedError('appErrors.inputLock.observer')
  }
  await prepareInteractionLock(access, [tab])
  if (access.findTab(tabId) !== tab || tab.webContents.isDestroyed()) throw new LocalizedError('appErrors.inputLock.tabClosed')
  const previousLocked = tab.humanInteractionLocked
  const wasGloballyUnlocked = access.globallyUnlockedTabIds().has(tabId)
  if (access.allHumanInteractionLocked()) {
    if (locked) access.globallyUnlockedTabIds().delete(tabId)
    else access.globallyUnlockedTabIds().add(tabId)
  } else {
    tab.humanInteractionLocked = locked
  }
  if (access.isHumanInteractionLocked(tab)) {
    if (tab.webContents.isDevToolsOpened()) tab.webContents.closeDevTools()
  }
  try {
    await access.syncHumanInteractionInputGuard(tab)
  } catch (error) {
    tab.humanInteractionLocked = previousLocked
    if (wasGloballyUnlocked) access.globallyUnlockedTabIds().add(tabId)
    else access.globallyUnlockedTabIds().delete(tabId)
    try {
      await access.syncHumanInteractionInputGuard(tab)
    } catch (rollbackError) {
      access.changed()
      // The message names the tab for logs; a person reads that this tab's lock is in doubt.
      throw new LocalizedError('appErrors.inputLock.tabNotRestored', undefined, {
        message: `Tab ${tab.id} interaction lock could not be updated or restored.`,
        cause: new AggregateError([error, rollbackError])
      })
    }
    access.changed()
    throw error
  }
  access.changed()
  return access.getState()
}

/**
 * Locks or unlocks the person's input in every tab, clearing the tabs
 * unlocked as exceptions. Changes run one at a time, and a failed native guard
 * update rolls every tab back.
 */
export function setAllHumanInteractionLocked<Tab extends InteractionLockTab>(access: InteractionLockAccess<Tab>, locked: boolean): Promise<BrowserState> {
  for (const tab of access.tabs()) tab.nativeInputEnvironmentGeneration += 1
  access.writeNativeInputLockMutations(access.nativeInputLockMutations() + 1)
  return enqueueInteractionLockMutation(access, () => applyAllHumanInteractionLocked(access, locked))
    .finally(() => { access.writeNativeInputLockMutations(access.nativeInputLockMutations() - 1) })
}

/** Applies the global lock change once every page is idle; locking closes Developer Tools. */
async function applyAllHumanInteractionLocked<Tab extends InteractionLockTab>(access: InteractionLockAccess<Tab>, locked: boolean): Promise<BrowserState> {
  await prepareInteractionLock(access, [...access.tabs()])
  if (access.isDestroyed()) throw new Error('Browser tabs manager has been destroyed')
  const previousLocked = access.allHumanInteractionLocked()
  const previousGloballyUnlockedTabIds = new Set(access.globallyUnlockedTabIds())
  access.writeAllHumanInteractionLocked(locked)
  access.globallyUnlockedTabIds().clear()
  access.layout()
  if (locked) {
    for (const tab of access.tabs()) {
      if (tab.webContents.isDevToolsOpened()) tab.webContents.closeDevTools()
    }
  }
  const results = await Promise.allSettled(
    [...access.tabs()].map((tab) => access.syncHumanInteractionInputGuard(tab))
  )
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
  if (errors.length) {
    access.writeAllHumanInteractionLocked(previousLocked)
    for (const tabId of previousGloballyUnlockedTabIds) access.globallyUnlockedTabIds().add(tabId)
    access.layout()
    const rollbackResults = await Promise.allSettled(
      [...access.tabs()].map((tab) => access.syncHumanInteractionInputGuard(tab))
    )
    const rollbackErrors = rollbackResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    access.changed()
    if (rollbackErrors.length) {
      throw new LocalizedError('appErrors.inputLock.allNotRestored', undefined, { cause: new AggregateError([...errors, ...rollbackErrors]) })
    }
    if (errors.length === 1) throw errors[0]
    throw new LocalizedError('appErrors.inputLock.allNotUpdated', undefined, { cause: new AggregateError(errors) })
  }
  access.changed()
  return access.getState()
}
