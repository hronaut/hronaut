import type { BrowserState } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'

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
    return browser.performCloseTab(tabId, ensureReplacement, false, true, yieldsToNewerSelection)
  }
  const tab = getTab(browser, tabId)
  const existing = browser.pendingHumanTabCloses.get(tabId)
  if (existing?.tab === tab) return existing.operation
  const operation = browser.performCloseTab(tabId, ensureReplacement, true, false, yieldsToNewerSelection)
  browser.pendingHumanTabCloses.set(tabId, { tab, operation })
  void operation.finally(() => {
    if (browser.pendingHumanTabCloses.get(tabId)?.operation === operation) browser.pendingHumanTabCloses.delete(tabId)
  }).catch(() => undefined)
  return operation
}
