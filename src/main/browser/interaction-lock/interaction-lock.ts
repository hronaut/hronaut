import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'
import { syncHumanInteractionInputGuard } from './human-input-guard.js'
import { tabInputLock } from './input-lock-state.js'

/** Runs the lock change after every earlier one, and its rollback, has settled. */
function enqueueInteractionLockMutation(browser: Browser, operation: () => Promise<BrowserState>): Promise<BrowserState> {
  const result = browser.interactionLockTail.then(() => {
    if (browser.destroyed) throw new Error('Browser tabs manager has been destroyed')
    return operation()
  })
  // Keep each mutation and any rollback together across tab and global requests.
  browser.interactionLockTail = result.then(() => undefined, () => undefined)
  return result
}

/**
 * Locks or unlocks the person's input in a tab, as an exception to a global
 * lock when there is one. Changes run one at a time, and a failed native guard
 * update rolls the tab back. Key holds and sequences on the page stop at once,
 * and native input tools on the page refuse until the change settles.
 */
export function setTabHumanInteractionLocked(browser: Browser, tabId: string, locked: boolean): Promise<BrowserState> {
  const tab = findTab(browser, tabId)
  const lockState = tab ? tabInputLock(tab) : undefined
  if (tab) tab.nativeInputEnvironmentGeneration += 1
  if (lockState) lockState.pendingChanges += 1
  return enqueueInteractionLockMutation(browser, () => applyTabHumanInteractionLocked(browser, tabId, locked))
    .finally(() => { if (lockState) lockState.pendingChanges -= 1 })
}

/**
 * Applies a tab's lock change: the tab shows the lock asked for at once, and
 * its page's native guard follows in the page's turn, after the debugger work
 * already queued there. A public observer workspace's pages stay locked, and
 * locking closes Developer Tools.
 */
async function applyTabHumanInteractionLocked(browser: Browser, tabId: string, locked: boolean): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  if (!locked && tab.mcpGroupId && browser.mcpTabGroups.get(tab.mcpGroupId)?.contextClass === 'public-observer') {
    throw new LocalizedError('appErrors.inputLock.observer')
  }
  if (tab.webContents.isDestroyed()) throw new LocalizedError('appErrors.inputLock.tabClosed')
  const previousLocked = tab.humanInteractionLocked
  const wasGloballyUnlocked = browser.globallyUnlockedTabIds.has(tabId)
  if (browser.allHumanInteractionLocked) {
    if (locked) browser.globallyUnlockedTabIds.delete(tabId)
    else browser.globallyUnlockedTabIds.add(tabId)
  } else {
    tab.humanInteractionLocked = locked
  }
  if (browser.isHumanInteractionLocked(tab)) {
    if (tab.webContents.isDevToolsOpened()) tab.webContents.closeDevTools()
  }
  publishChange(browser)
  try {
    // Waits its turn behind the page's queued debugger work, however long that takes, rather than failing.
    await syncHumanInteractionInputGuard(browser, tab)
  } catch (error) {
    tab.humanInteractionLocked = previousLocked
    if (wasGloballyUnlocked) browser.globallyUnlockedTabIds.add(tabId)
    else browser.globallyUnlockedTabIds.delete(tabId)
    try {
      await syncHumanInteractionInputGuard(browser, tab)
    } catch (rollbackError) {
      publishChange(browser)
      // The message names the tab for logs; a person reads that this tab's lock is in doubt.
      throw new LocalizedError('appErrors.inputLock.tabNotRestored', undefined, {
        message: `Tab ${tab.id} interaction lock could not be updated or restored.`,
        cause: new AggregateError([error, rollbackError])
      })
    }
    publishChange(browser)
    throw error
  }
  return browserState(browser)
}

/**
 * Locks or unlocks the person's input in every tab, clearing the tabs
 * unlocked as exceptions. Changes run one at a time, and a failed native guard
 * update rolls every tab back. Key holds and sequences stop at once, and
 * native input tools refuse on every page until the change settles.
 */
export function setAllHumanInteractionLocked(browser: Browser, locked: boolean): Promise<BrowserState> {
  for (const tab of browser.tabs.values()) tab.nativeInputEnvironmentGeneration += 1
  browser.globalInputLockChanges += 1
  return enqueueInteractionLockMutation(browser, () => applyAllHumanInteractionLocked(browser, locked))
    .finally(() => { browser.globalInputLockChanges -= 1 })
}

/**
 * Applies the global lock change: every tab shows it at once, and each page's
 * native guard follows in that page's turn. Locking closes Developer Tools.
 */
async function applyAllHumanInteractionLocked(browser: Browser, locked: boolean): Promise<BrowserState> {
  const previousLocked = browser.allHumanInteractionLocked
  const previousGloballyUnlockedTabIds = new Set(browser.globallyUnlockedTabIds)
  browser.allHumanInteractionLocked = locked
  browser.globallyUnlockedTabIds.clear()
  browser.layout()
  if (locked) {
    for (const tab of browser.tabs.values()) {
      if (tab.webContents.isDevToolsOpened()) tab.webContents.closeDevTools()
    }
  }
  publishChange(browser)
  // Each page's guard waits its turn behind that page's queued debugger work, however long that takes.
  const results = await Promise.allSettled(
    [...browser.tabs.values()].map((tab) => syncHumanInteractionInputGuard(browser, tab))
  )
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
  if (errors.length) {
    browser.allHumanInteractionLocked = previousLocked
    for (const tabId of previousGloballyUnlockedTabIds) browser.globallyUnlockedTabIds.add(tabId)
    browser.layout()
    const rollbackResults = await Promise.allSettled(
      [...browser.tabs.values()].map((tab) => syncHumanInteractionInputGuard(browser, tab))
    )
    const rollbackErrors = rollbackResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    publishChange(browser)
    if (rollbackErrors.length) {
      throw new LocalizedError('appErrors.inputLock.allNotRestored', undefined, { cause: new AggregateError([...errors, ...rollbackErrors]) })
    }
    if (errors.length === 1) throw errors[0]
    throw new LocalizedError('appErrors.inputLock.allNotUpdated', undefined, { cause: new AggregateError(errors) })
  }
  return browserState(browser)
}
