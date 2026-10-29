import type { WebContents } from 'electron'
import type { Browser } from '../browser.js'
import { findTab, orderedTabs } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { cancelNativeSelectionSessions } from '../native-selections/native-selections.js'
import { publishPageGeometry } from '../page-geometry/page-geometry.js'
import { invalidateTabOverviewPreview } from '../tab-overview-previews/tab-overview-previews.js'
import { focusTabOrTrustedChrome } from '../trusted-chrome-focus/trusted-chrome-focus.js'
import { publishChange } from '../browser-state/browser-state.js'

/** Hronaut Home, which a destroyed page's recovery opens when no live tab is left; the tab manager's Home address. */
const HRONAUT_HOME_URL = 'hronaut://home/'

/**
 * Handles the page being destroyed. It always stops the favicon load, the
 * overview preview, network waits and selection sessions; a closure the
 * manager expected only forgets dialog monitoring and execution contexts.
 * Otherwise it shows that the page is gone and keeps the browser usable.
 */
export function attachPageDestroyedEvents(browser: Browser, tab: BrowserTab, webContents: WebContents): void {
  webContents.once('destroyed', () => {
    tab.faviconAbortController?.abort()
    tab.faviconAbortController = undefined
    invalidateTabOverviewPreview(browser, tab)
    browser.tabOverviewPreviewCaptures.cancelPending(tab.id)
    browser.tabOverviewPreviewableTabs.delete(tab.id)
    browser.networkWaitController.reject(tab.id, 'The tab renderer became unavailable while waiting for network activity.')
    cancelNativeSelectionSessions(browser, tab)
    if (browser.expectedTabClosures.has(webContents)) {
      browser.dialogMonitorAttachPromises.delete(webContents.id)
      browser.defaultExecutionContexts.delete(webContents.id)
      return
    }
    recoverFromDestroyedPage(browser, tab)
  })
}

/**
 * Shows that the tab's page is gone, while the tab is still open: it cancels
 * wallet requests, shows the problem, and keeps the browser usable: a split
 * view partner takes over, or another live tab is selected, or a new Home tab
 * is opened. Once the window is gone, as when Hronaut exits at once, there is
 * no browser left to keep usable.
 */
export function recoverFromDestroyedPage(browser: Browser, tab: BrowserTab): void {
  if (browser.destroyed || browser.window.isDestroyed() || findTab(browser, tab.id) !== tab) return
  browser.runWalletLifecycleAction('cancel wallet requests after a tab renderer closes', () => (
    browser.options.onWalletTabClosed?.(tab.id)
  ))
  tab.loading = false
  tab.pageProblem = {
    kind: 'renderer-gone',
    title: browser.text('native.dialog.pageDestroyedTitle'),
    message: browser.text('native.dialog.pageDestroyedMessage'),
    url: tab.url,
    reason: 'renderer-destroyed'
  }
  if (browser.splitViewContains(tab.id)) {
    const split = browser.splitView!
    const partnerId = split.firstTabId === tab.id ? split.secondTabId : split.firstTabId
    const partner = findTab(browser, partnerId)
    browser.splitView = null
    try {
      browser.window.contentView.removeChildView(tab.view)
    } catch (error) {
      console.warn(`[browser] Could not detach destroyed split pane ${tab.id}:`, error)
    }
    if (partner && !partner.webContents.isDestroyed()) {
      if (browser.activeTabId === tab.id) {
        browser.writeActiveTabId(partner.id)
        partner.lastActiveAt = Date.now()
        browser.markTabActiveInGroup(partner)
      }
      browser.layout()
      if (browser.activeTabId === partner.id) focusTabOrTrustedChrome(browser, partner)
      publishChange(browser)
      return
    }
  }

  const active = browser.activeTabId ? findTab(browser, browser.activeTabId!) : undefined
  if (active && !active.webContents.isDestroyed()) {
    publishChange(browser)
    return
  }
  const replacement = orderedTabs(browser).find((candidate) => (
    candidate.id !== tab.id && !candidate.webContents.isDestroyed()
  ))
  if (replacement) {
    try {
      browser.selectTab(replacement.id)
      return
    } catch (error) {
      console.error('[browser] Could not activate a live tab after renderer teardown:', error)
    }
  }
  if (active) {
    try {
      browser.window.contentView.removeChildView(active.view)
    } catch (error) {
      console.warn(`[browser] Could not detach destroyed active pane ${active.id}:`, error)
    }
  }
  browser.writeActiveTabId(null)
  publishChange(browser, false)
  publishPageGeometry(browser)
  void browser.createTab({ url: HRONAUT_HOME_URL, active: true })
    .catch((error) => {
      console.error('[browser] Could not create a replacement tab after renderer teardown:', error)
      browser.options.onActionFailed?.('recover from a closed page renderer', error)
    })
}
