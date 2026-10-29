import type { WebContents } from 'electron'
import type { PageDestroyedEventsAccess, PageDestroyedEventsTab } from './page-destroyed-events-access.js'

/** Hronaut Home, which a destroyed page's recovery opens when no live tab is left; the tab manager's Home address. */
const HRONAUT_HOME_URL = 'hronaut://home/'

/**
 * Handles the page being destroyed. It always stops the favicon load, the
 * overview preview, network waits and selection sessions; a closure the
 * manager expected only forgets dialog monitoring and execution contexts.
 * Otherwise it shows that the page is gone and keeps the browser usable.
 */
export function attachPageDestroyedEvents<Tab extends PageDestroyedEventsTab>(access: PageDestroyedEventsAccess<Tab>, tab: Tab, webContents: WebContents): void {
  webContents.once('destroyed', () => {
    tab.faviconAbortController?.abort()
    tab.faviconAbortController = undefined
    access.invalidateTabOverviewPreview(tab)
    access.tabOverviewPreviewCaptures().cancelPending(tab.id)
    access.tabOverviewPreviewableTabs().delete(tab.id)
    access.networkWaitController().reject(tab.id, 'The tab renderer became unavailable while waiting for network activity.')
    access.cancelNativeSelectionSessions(tab)
    if (access.expectedTabClosures().has(webContents)) {
      access.dialogMonitorAttachPromises().delete(webContents.id)
      access.defaultExecutionContexts().delete(webContents.id)
      return
    }
    recoverFromDestroyedPage(access, tab)
  })
}

/**
 * Shows that the tab's page is gone, while the tab is still open: it cancels
 * wallet requests, shows the problem, and keeps the browser usable: a split
 * view partner takes over, or another live tab is selected, or a new Home tab
 * is opened. Once the window is gone, as when Hronaut exits at once, there is
 * no browser left to keep usable.
 */
export function recoverFromDestroyedPage<Tab extends PageDestroyedEventsTab>(access: PageDestroyedEventsAccess<Tab>, tab: Tab): void {
  if (access.isDestroyed() || access.window().isDestroyed() || access.findTab(tab.id) !== tab) return
  access.runWalletLifecycleAction('cancel wallet requests after a tab renderer closes', () => (
    access.options().onWalletTabClosed?.(tab.id)
  ))
  tab.loading = false
  tab.pageProblem = {
    kind: 'renderer-gone',
    title: access.text('native.dialog.pageDestroyedTitle'),
    message: access.text('native.dialog.pageDestroyedMessage'),
    url: tab.url,
    reason: 'renderer-destroyed'
  }
  if (access.splitViewContains(tab.id)) {
    const split = access.splitView()!
    const partnerId = split.firstTabId === tab.id ? split.secondTabId : split.firstTabId
    const partner = access.findTab(partnerId)
    access.writeSplitView(null)
    try {
      access.window().contentView.removeChildView(tab.view)
    } catch (error) {
      console.warn(`[browser] Could not detach destroyed split pane ${tab.id}:`, error)
    }
    if (partner && !partner.webContents.isDestroyed()) {
      if (access.activeTabId() === tab.id) {
        access.writeActiveTabId(partner.id)
        partner.lastActiveAt = Date.now()
        access.markTabActiveInGroup(partner)
      }
      access.layout()
      if (access.activeTabId() === partner.id) access.focusTabOrTrustedChrome(partner)
      access.changed()
      return
    }
  }

  const active = access.activeTabId() ? access.findTab(access.activeTabId()!) : undefined
  if (active && !active.webContents.isDestroyed()) {
    access.changed()
    return
  }
  const replacement = access.orderedTabs().find((candidate) => (
    candidate.id !== tab.id && !candidate.webContents.isDestroyed()
  ))
  if (replacement) {
    try {
      access.selectTab(replacement.id)
      return
    } catch (error) {
      console.error('[browser] Could not activate a live tab after renderer teardown:', error)
    }
  }
  if (active) {
    try {
      access.window().contentView.removeChildView(active.view)
    } catch (error) {
      console.warn(`[browser] Could not detach destroyed active pane ${active.id}:`, error)
    }
  }
  access.writeActiveTabId(null)
  access.changed(false)
  access.publishPageGeometry()
  void access.createTab({ url: HRONAUT_HOME_URL, active: true })
    .catch((error) => {
      console.error('[browser] Could not create a replacement tab after renderer teardown:', error)
      access.options().onActionFailed?.('recover from a closed page renderer', error)
    })
}
