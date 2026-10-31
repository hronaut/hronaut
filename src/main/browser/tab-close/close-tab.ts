import type { BrowserState } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import { findTab, getTab, orderedTabs } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'
import type { NavigationHistorySnapshot } from '../navigation-history.js'
import { cancelNativeSelectionSessions } from '../native-selections/native-selections.js'
import { holdTabHistory } from '../tab-history-pages/forget-tab-history-pages.js'
import { withTabLabelLifecycle } from '../tab-labels/tab-labels.js'
import { rememberClosedTab } from '../tab-reopening/tab-reopening.js'
import { focusTabOrTrustedChrome, focusPageAfterQuestion, keyboardPage } from '../trusted-chrome-focus/trusted-chrome-focus.js'
import { detachDialogMonitoring, ensureDialogMonitoring } from '../website-dialogs/website-dialogs.js'
import { attemptBeforeUnloadClose } from './before-unload-close.js'
import { stageBeforeUnloadClose } from './before-unload-staging.js'
import { closeTabTransition } from './close-transition.js'
import { removeTabRecord } from './remove-tab-record.js'
import { markTabActiveInGroup } from '../tab-selection/active-tab.js'
import { selectTabForPerson } from '../tab-selection/person-tab-switch.js'

const HRONAUT_HOME_URL = 'hronaut://home/'

/**
 * Closes the tab once tab label saves have settled. Without
 * respectBeforeUnload the page cannot keep itself open. With it, the page's
 * beforeunload handlers may ask the person to stay, and a second such close
 * of the same tab joins the one in flight instead of asking again. With
 * yieldsToNewerSelection, a shown tab stays open when another tab is selected
 * while the tab that replaces it wakes.
 */
export function closeTabAfterLabelSave(browser: Browser, tabId: string, ensureReplacement: boolean, respectBeforeUnload: boolean, yieldsToNewerSelection: boolean): Promise<BrowserState> {
  if (!respectBeforeUnload) {
    return performCloseTab(browser, tabId, ensureReplacement, false, true, yieldsToNewerSelection)
  }
  const tab = getTab(browser, tabId)
  const existing = browser.pendingHumanTabCloses.get(tabId)
  if (existing?.tab === tab) return existing.operation
  const operation = performCloseTab(browser, tabId, ensureReplacement, true, false, yieldsToNewerSelection)
  browser.pendingHumanTabCloses.set(tabId, { tab, operation })
  void operation.finally(() => {
    if (browser.pendingHumanTabCloses.get(tabId)?.operation === operation) browser.pendingHumanTabCloses.delete(tabId)
  }).catch(() => undefined)
  return operation
}

/**
 * Closes a tab, opening a replacement when it was the last, letting its page ask to stay when respectBeforeUnload
 * is set, and keeping a shown tab open when yieldsToNewerSelection is set and another tab is selected while the tab
 * that replaces it wakes.
 */
export function closeTab(
  browser: Browser,
  tabId: string,
  ensureReplacement: boolean,
  respectBeforeUnload = false,
  yieldsToNewerSelection = false
): Promise<BrowserState> {
  return withTabLabelLifecycle(browser, () => closeTabAfterLabelSave(browser, tabId, ensureReplacement, respectBeforeUnload, yieldsToNewerSelection))
}

/**
 * Closes tabs together, such as a workspace's. The active one closes last,
 * so it hands over to a tab that stays open rather than waking a sleeping
 * one only to close it next.
 */
export async function closeTabs(browser: Browser, tabIds: string[], ensureReplacement = true): Promise<BrowserState> {
  const pending = [...tabIds]
  while (pending.length) {
    const inactiveIndex = pending.findIndex((tabId) => tabId !== browser.activeTabId)
    const tabId = pending.splice(inactiveIndex === -1 ? 0 : inactiveIndex, 1)[0]!
    if (browser.tabs.has(tabId)) await closeTab(browser, tabId, ensureReplacement)
  }
  return browserState(browser)
}

/**
 * Wakes the sleeping tab that replaces the shown tab before it closes. False
 * when the close stops: the tab closed meanwhile, or the close yields to a
 * tab selected while the replacement wakes, as the person's own close does.
 * A close that does not yield, such as an agent's or a whole workspace's,
 * still closes the tab, which needs no replacement once another tab shows.
 */
async function prepareActiveCloseReplacement(browser: Browser, tab: BrowserTab, yieldsToNewerSelection: boolean): Promise<boolean> {
  if (tab.id !== browser.activeTabId) return true
  const selectionGeneration = browser.tabSelectionGeneration
  /** Whether the close stops, goes on with no replacement to wake, or still waits for the tab's replacement. */
  const nextStep = (): 'stop' | 'close' | 'wake' => {
    if (browser.tabs.get(tab.id) !== tab) return 'stop'
    if (browser.activeTabId === tab.id && browser.tabSelectionGeneration === selectionGeneration) return 'wake'
    if (yieldsToNewerSelection) return 'stop'
    return browser.activeTabId === tab.id ? 'wake' : 'close'
  }
  while (true) {
    const step = nextStep()
    if (step !== 'wake') return step === 'close'
    const transition = closeTabTransition(browser, tab)
    if (!transition.nextId) return true
    const replacement = browser.tabs.get(transition.nextId)
    if (!replacement || (!replacement.sleeping && !replacement.wakePromise)) return true
    try {
      await browser.wakeTab(replacement.id)
    } catch (error) {
      const stepAfterFailure = nextStep()
      if (stepAfterFailure !== 'wake') return stepAfterFailure === 'close'
      const currentReplacementId = closeTabTransition(browser, tab).nextId
      if (browser.tabs.get(replacement.id) !== replacement || currentReplacementId !== replacement.id) {
        continue
      }
      throw error
    }
    // Tab ordering and split membership can change while a sleeping page is
    // restoring without changing the active selection. Recompute until the
    // actual close successor is awake before committing irreversible state.
  }
}

/**
 * Closes the tab, opening a replacement when it was the last and ensureReplacement is set. A page closed from
 * behind the shown tab that asks to stay is shown for the person's question; once they discard it, they are back on
 * the tab they were on. A tab the person moves away from while its page decides stays behind for the question.
 */
async function performCloseTab(
  browser: Browser,
  tabId: string,
  ensureReplacement: boolean,
  respectBeforeUnload: boolean,
  forceClose: boolean,
  yieldsToNewerSelection: boolean
): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  const webContents = tab.webContents
  // A WebContentsView may be destroyed independently (renderer failure,
  // devtools teardown, or an Electron close race). Purge those stale siblings
  // before any child-view transition so they cannot poison selection/layout.
  for (const candidate of [...browser.tabs.values()]) {
    if (candidate.id === tab.id || !candidate.webContents.isDestroyed()) continue
    if (browser.splitViewContains(candidate.id)) browser.splitView = null
    if (browser.activeTabId === candidate.id) browser.activeTabId = null
    rememberClosedTab(browser, candidate)
    removeTabRecord(browser, candidate)
  }
  if (!browser.activeTabId) {
    const replacement = orderedTabs(browser).find(candidate => (
      candidate.id !== tab.id && !candidate.webContents.isDestroyed()
    ))
    if (replacement) browser.selectTab(replacement.id)
    else if (!webContents.isDestroyed()) browser.selectTab(tab.id)
  }
  if (!(await prepareActiveCloseReplacement(browser, tab, yieldsToNewerSelection))) return browserState(browser)
  if (browser.tabs.get(tab.id) !== tab) return browserState(browser)
  let stagedClose: ReturnType<typeof stageBeforeUnloadClose> | undefined
  // A page that lets the tab close is gone once it answers, with its history, which Reopen closed tab restores.
  let closingHistory: NavigationHistorySnapshot | undefined
  if (respectBeforeUnload && !forceClose && !webContents.isDestroyed()) {
    closingHistory = holdTabHistory(browser.navigationHistorySnapshot(tab))
    const navigationGeneration = tab.navigationGeneration
    // Taking the page out of view while it decides takes the keyboard from it, which it gets back only if it had it.
    const pageHadKeyboard = keyboardPage(browser) === webContents
    // A tab the person closed from behind the one shown; one they move away from while its page decides stays behind.
    const closedFromBehind = browser.activeTabId !== tab.id && !browser.splitViewContains(tab.id)
    stagedClose = stageBeforeUnloadClose(browser, tab)
    browser.expectedTabClosures.add(webContents)
    let disposition: 'closed' | 'prevented'
    try {
      // Electron implements beforeunload through the same Chromium dialog
      // channel used by our diagnostics debugger. Suspend that debugger for
      // the native close probe so it cannot race Electron's own handling.
      detachDialogMonitoring(browser, webContents)
      disposition = await attemptBeforeUnloadClose(webContents)
    } catch (error) {
      browser.expectedTabClosures.delete(webContents)
      stagedClose.rollback(pageHadKeyboard)
      if (!webContents.isDestroyed() && browser.tabs.get(tab.id) === tab) {
        await ensureDialogMonitoring(browser, tab)
      }
      throw error
    }
    browser.expectedTabClosures.delete(webContents)
    if (disposition === 'prevented') {
      // The question over the page takes the keyboard now; a page that had it gets it back once the person keeps it.
      stagedClose.rollback(false)
      // The question is about this page, so a tab closed from behind comes into view first, as Chrome shows the page
      // that asks.
      const shownBefore = browser.activeTabId
      const broughtIntoView = closedFromBehind && !webContents.isDestroyed() && browser.tabs.get(tab.id) === tab
        && browser.activeTabId !== tab.id && !browser.splitViewContains(tab.id)
      if (broughtIntoView) await selectTabForPerson(browser, tab.id)
      // A page the person was shown for the question and kept is the one they went on to edit.
      const keepPage = (): void => {
        if ((pageHadKeyboard || broughtIntoView) && !webContents.isDestroyed()) focusPageAfterQuestion(browser, webContents)
      }
      if (!webContents.isDestroyed() && browser.tabs.get(tab.id) === tab) {
        await ensureDialogMonitoring(browser, tab)
      }
      let confirmed: boolean
      try {
        confirmed = await (browser.options.confirmBeforeUnloadClose?.() ?? Promise.resolve(false))
      } catch (error) {
        console.error('[browser] Could not confirm closing a page with unsaved changes:', error)
        browser.options.onActionFailed?.('confirm closing a tab', error)
        keepPage()
        return browserState(browser)
      }
      if (!confirmed) {
        keepPage()
        return browserState(browser)
      }
      if (
        browser.tabs.get(tab.id) !== tab
        || tab.webContents !== webContents
        || webContents.isDestroyed()
        || tab.navigationGeneration !== navigationGeneration
      ) {
        // The page changed while the person decided, so it stays open as if they had kept it.
        keepPage()
        return browserState(browser)
      }
      // The person goes back to the tab they were on, unless they moved meanwhile, and the page they discarded closes.
      if (broughtIntoView && shownBefore && browser.activeTabId === tab.id && findTab(browser, shownBefore)) {
        await selectTabForPerson(browser, shownBefore)
      }
      return performCloseTab(browser, tabId, ensureReplacement, true, true, yieldsToNewerSelection)
    }
    if (browser.tabs.get(tab.id) !== tab) {
      stagedClose.cleanup()
      return browserState(browser)
    }
  }
  const wasActive = tab.id === browser.activeTabId
  browser.networkWaitController.reject(tab.id, 'The tab closed while waiting for network activity.')
  browser.reproRecorder.clearReproRecording(tab)
  browser.videoRecorder.clear(tab.id)
  cancelNativeSelectionSessions(browser, tab)
  const { splitPartnerId, nextId } = closeTabTransition(browser, tab)
  rememberClosedTab(browser, tab, closingHistory)

  if (splitPartnerId) {
    const splitPartner = browser.tabs.get(splitPartnerId)
    if (!stagedClose && wasActive && splitPartner && splitPartner.id !== nextId && !splitPartner.webContents.isDestroyed()) {
      browser.window.contentView.removeChildView(splitPartner.view)
    }
    browser.splitView = null
  }
  // Move a live replacement into the BrowserWindow before destroying the
  // current view. Electron can otherwise leave the parent view in an invalid
  // child transition after a neighboring WebContentsView was destroyed.
  if (wasActive && nextId) {
    if (stagedClose) {
      const replacement = browser.tabs.get(nextId)
      if (replacement && !replacement.webContents.isDestroyed()) {
        // Ordering can change during beforeunload without changing the
        // active tab. Attach the current successor, even if staging picked
        // a different view before the asynchronous close probe.
        browser.window.contentView.addChildView(replacement.view)
        browser.tabSelectionGeneration += 1
        replacement.lastActiveAt = performance.now()
        browser.activeTabId = replacement.id
        markTabActiveInGroup(browser, replacement)
      }
    } else {
      browser.selectTab(nextId)
    }
  } else if ((wasActive || splitPartnerId) && !stagedClose?.targetDetached) {
    browser.window.contentView.removeChildView(tab.view)
  }

  stagedClose?.cleanup()
  removeTabRecord(browser, tab)
  if (!webContents.isDestroyed()) {
    detachDialogMonitoring(browser, webContents)
    webContents.close()
  }

  if ((!browser.tabs.size || (wasActive && !nextId)) && ensureReplacement) {
    for (const candidate of [...browser.tabs.values()]) {
      if (!candidate.webContents.isDestroyed()) continue
      rememberClosedTab(browser, candidate)
      removeTabRecord(browser, candidate)
    }
    await browser.createTab({ url: HRONAUT_HOME_URL, active: true })
  } else {
    if (!browser.tabs.size || (wasActive && !nextId)) browser.activeTabId = null
    browser.layout()
    if (stagedClose && wasActive && browser.activeTabId) {
      const replacement = browser.tabs.get(browser.activeTabId)
      if (replacement && !replacement.webContents.isDestroyed()) focusTabOrTrustedChrome(browser, replacement)
    }
    publishChange(browser)
  }
  return browserState(browser)
}
