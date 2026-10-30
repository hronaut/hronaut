import { powerMonitor } from 'electron'
import type { Browser } from '../browser.js'
import { disposeHeldResponses } from '../network-conditions/held-responses.js'
import { cancelFocusAfterTrustedChrome } from '../trusted-chrome-focus/trusted-chrome-focus.js'
import { detachDialogMonitoring } from '../website-dialogs/website-dialogs.js'

/** Stops the browser: every page closes, and every timer, listener and pending request it holds ends. */
export function destroyBrowser(browser: Browser): void {
  powerMonitor.removeListener('suspend', browser.pauseVideoForSuspend)
  browser.videoRecorder.destroy()
  if (browser.destroyed) return
  browser.splitDivider.cancel()
  cancelFocusAfterTrustedChrome(browser)
  browser.destroyed = true
  browser.pwaLifecycleRecorder.dispose()
  browser.faviconDecoder.dispose()
  browser.mcpActivityFollower.dispose()
  browser.stopPresentationWatcher?.()
  if (browser.persistTimer) clearTimeout(browser.persistTimer)
  browser.statePublication.dispose()
  if (browser.tabHistoryTimer) clearInterval(browser.tabHistoryTimer)
  if (browser.memorySaverTimer) clearInterval(browser.memorySaverTimer)
  browser.downloadController.clearPendingNotification()
  for (const timer of browser.tabOverviewPreviewTimers.values()) clearTimeout(timer)
  browser.tabOverviewPreviewTimers.clear()
  browser.tabOverviewPreviewCaptures.clear()
  browser.tabOverviewPreviewableTabs.clear()
  browser.tabOverviewPreviews.clear()
  browser.tabOverviewSleepPreviews.clear()
  browser.networkWaitController.dispose()
  for (const session of browser.screenshotAreaSessions.values()) {
    session.canceled = true
    session.resolve({ canceled: true })
  }
  browser.screenshotAreaSessions.clear()
  for (const session of browser.elementPickerSessions.values()) {
    session.canceled = true
    session.resolve({ canceled: true })
  }
  browser.elementPickerSessions.clear()
  for (const tab of browser.tabs.values()) {
    browser.reproRecorder.clearReproRecording(tab)
    try {
      if (!tab.webContents.isDestroyed()) {
        detachDialogMonitoring(browser, tab.webContents)
        tab.webContents.close()
      }
    } catch {
      // The parent BrowserWindow may already have destroyed its child views during shutdown.
    }
  }
  browser.tabs.clear()
  browser.workspaceRegistry.dispose()
  browser.mcpActivitiesByTab.clear()
  browser.webContentsToTab.clear()
  browser.authorizedAgentMouseInput.clear()
  browser.authorizedAgentKeyboardInput.clear()
  browser.downloadController.destroy()
  browser.reactInspectionController.dispose()
  browser.fixedDateController.dispose()
  browser.debuggerQueue.clear()
  browser.networkRouteQueues.clear()
  for (const timer of browser.networkRouteRefreshTimers.values()) clearTimeout(timer)
  browser.networkRouteRefreshTimers.clear()
  disposeHeldResponses(browser.heldNetworkResponseStates)
  browser.defaultExecutionContexts.clear()
  browser.renderQueues.clear()
  browser.occlusionSnapshot.dispose()
  for (const releaseFocusGuard of browser.agentInputFocusGuardReleases.values()) releaseFocusGuard()
  browser.agentInputFocusGuardReleases.clear()
  browser.agentInputWebContents.clear()
  browser.agentInputFocusSnapshots.clear()
  for (const [browserSession, listener] of browser.browserSessionAuthorityHooks) {
    browserSession.cookies.removeListener('changed', listener)
  }
  browser.browserSessionAuthorityHooks.clear()
}
