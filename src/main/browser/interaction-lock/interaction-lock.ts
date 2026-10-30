import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'

/**
 * Waits briefly for the tabs' pending debugger commands and dialog monitor
 * attachments, and rejects without changing anything when a page stays busy.
 */
async function prepareInteractionLock(browser: Browser, tabs: readonly BrowserTab[]): Promise<void> {
  // Do not mutate lock state or enqueue guard writes behind an indefinitely
  // pending native command. A late queue completion cannot apply this request.
  const pending = tabs.flatMap(tab => [
    browser.debuggerQueue.pending(tab.webContents.id),
    browser.dialogMonitorAttachPromises.get(tab.webContents.id)
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
 * update rolls the tab back.
 */
export function setTabHumanInteractionLocked(browser: Browser, tabId: string, locked: boolean): Promise<BrowserState> {
  const tab = findTab(browser, tabId)
  if (tab) tab.nativeInputEnvironmentGeneration += 1
  browser.nativeInputLockMutations += 1
  return enqueueInteractionLockMutation(browser, () => applyTabHumanInteractionLocked(browser, tabId, locked))
    .finally(() => { browser.nativeInputLockMutations -= 1 })
}

/**
 * Applies a tab's lock change once its page is idle. A public observer
 * workspace's pages stay locked, and locking closes Developer Tools.
 */
async function applyTabHumanInteractionLocked(browser: Browser, tabId: string, locked: boolean): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  if (!locked && tab.mcpGroupId && browser.mcpTabGroups.get(tab.mcpGroupId)?.contextClass === 'public-observer') {
    throw new LocalizedError('appErrors.inputLock.observer')
  }
  await prepareInteractionLock(browser, [tab])
  if (findTab(browser, tabId) !== tab || tab.webContents.isDestroyed()) throw new LocalizedError('appErrors.inputLock.tabClosed')
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
  try {
    await browser.syncHumanInteractionInputGuard(tab)
  } catch (error) {
    tab.humanInteractionLocked = previousLocked
    if (wasGloballyUnlocked) browser.globallyUnlockedTabIds.add(tabId)
    else browser.globallyUnlockedTabIds.delete(tabId)
    try {
      await browser.syncHumanInteractionInputGuard(tab)
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
  publishChange(browser)
  return browserState(browser)
}

/**
 * Locks or unlocks the person's input in every tab, clearing the tabs
 * unlocked as exceptions. Changes run one at a time, and a failed native guard
 * update rolls every tab back.
 */
export function setAllHumanInteractionLocked(browser: Browser, locked: boolean): Promise<BrowserState> {
  for (const tab of browser.tabs.values()) tab.nativeInputEnvironmentGeneration += 1
  browser.nativeInputLockMutations += 1
  return enqueueInteractionLockMutation(browser, () => applyAllHumanInteractionLocked(browser, locked))
    .finally(() => { browser.nativeInputLockMutations -= 1 })
}

/** Applies the global lock change once every page is idle; locking closes Developer Tools. */
async function applyAllHumanInteractionLocked(browser: Browser, locked: boolean): Promise<BrowserState> {
  await prepareInteractionLock(browser, [...browser.tabs.values()])
  if (browser.destroyed) throw new Error('Browser tabs manager has been destroyed')
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
  const results = await Promise.allSettled(
    [...browser.tabs.values()].map((tab) => browser.syncHumanInteractionInputGuard(tab))
  )
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
  if (errors.length) {
    browser.allHumanInteractionLocked = previousLocked
    for (const tabId of previousGloballyUnlockedTabIds) browser.globallyUnlockedTabIds.add(tabId)
    browser.layout()
    const rollbackResults = await Promise.allSettled(
      [...browser.tabs.values()].map((tab) => browser.syncHumanInteractionInputGuard(tab))
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
  publishChange(browser)
  return browserState(browser)
}
