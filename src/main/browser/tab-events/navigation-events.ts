import type { WebContents } from 'electron'
import { retireNetworkPriorityObservations } from '../network-recording.js'
import { loadFailureProblem } from '../page-load-problem.js'
import { normalizeTabTitle } from '../tab-metadata.js'
import { isWebUrl } from '../url.js'
import type { NavigationEventsAccess, NavigationEventsTab } from './navigation-events-access.js'

/** Chromium's error code for a load that was aborted, which shows no load failure. */
const ABORTED_LOAD_ERROR = -3

/**
 * Follows the page's title, loading and navigation: title updates, loading
 * start, the workspace navigation policy for main-frame navigations and
 * redirects, the fresh document a main-frame navigation starts, favicons,
 * sign-in challenges (observed only), audio, loading stop, commits within
 * and across documents, load failures and the document becoming ready, which
 * records history, starts credential and form watching and restores the
 * interaction lock in the page and its frames.
 */
export function attachNavigationEvents<Tab extends NavigationEventsTab>(access: NavigationEventsAccess<Tab>, tab: Tab, webContents: WebContents): void {
  const syncNavigation = (): void => {
    if (access.isDestroyed() || webContents.isDestroyed()) return
    tab.url = webContents.getURL() || tab.url
    tab.loading = webContents.isLoading()
    access.changed()
  }
  const recordPendingHistory = (): void => {
    if (tab.suppressInitialHistory || tab.pendingHistoryUrl !== tab.url) return
    tab.title = normalizeTabTitle(webContents.getTitle(), tab.title)
    access.recordVisit(tab)
    tab.pendingHistoryUrl = null
  }
  webContents.on('page-title-updated', (_event, title, explicitSet) => {
    if (tab.sleeping) return
    tab.discoveryTitle.observe(title, explicitSet === true)
    const nextTitle = normalizeTabTitle(title, tab.title)
    const titleChanged = nextTitle !== tab.title
    tab.title = nextTitle
    if (titleChanged) {
      access.options().onPageTitleUpdated?.({
        url: webContents.getURL() || tab.url,
        title: nextTitle
      })
    }
    access.changed()
  })
  webContents.on('did-start-loading', () => {
    if (tab.sleeping) return
    tab.loading = true
    tab.sleeping = false
    tab.lastActiveAt = Date.now()
    tab.pageProblem = undefined
    access.changed(false)
  })
  webContents.on('will-frame-navigate', (details) => {
    if (tab.sleeping || !details.isMainFrame) return
    if (tab.mcpGroupId
      && !access.workspaceNavigationAllowed(tab.mcpGroupId, details.url, 'page')) {
      tab.navigationPolicyDenialSequence += 1
      details.preventDefault()
      return
    }
    access.prepareDiagnosticNavigation(tab)
  })
  webContents.on('will-redirect', (details) => {
    if (!tab.mcpGroupId || !details.isMainFrame) return
    if (!access.workspaceNavigationAllowed(tab.mcpGroupId, details.url, 'redirect')) {
      tab.navigationPolicyDenialSequence += 1
      details.preventDefault()
    }
  })
  webContents.on('did-start-navigation', (_event, _navigationUrl, isSameDocument, isMainFrame) => {
    if (tab.sleeping || !isMainFrame) return
    // Chromium applies lifecycle state to a document, not to the durable tab.
    // Any main-frame navigation establishes a fresh active document. The
    // explicit hold is never persisted or silently replayed across it.
    tab.pageLifecycleState = 'active'
    tab.pageLifecycleUnknownRequest = undefined
    tab.pageLifecycleAnimations = undefined
    tab.navigationGeneration += 1
    retireNetworkPriorityObservations(tab)
    access.invalidateTabOverviewPreview(tab)
    if (!isSameDocument) {
      tab.walletNavigationGeneration = tab.navigationGeneration
      access.runWalletLifecycleAction('cancel wallet requests after tab navigation', () => (
        access.options().onWalletNavigation?.(tab.id, tab.walletNavigationGeneration)
      ))
    }
    if (isSameDocument) {
      tab.performanceDocumentRouted = true
      return
    }
    // Remove it now, not at commit: a navigation that never commits (a download or a 204) keeps the old document.
    void access.cssStatePreview().clear(tab, 'navigation').catch(() => undefined)
    tab.discoveryTitle.clear()
    tab.faviconAbortController?.abort()
    tab.faviconAbortController = undefined
    tab.faviconRequestId += 1
    access.cancelNativeSelectionSessions(tab)
    tab.inspectorIssues = []
    tab.inspectorIssuesTruncated = false
    tab.authChallenges = []
    tab.authChallengesTruncated = false
    tab.authNavigationPending = true
    tab.securitySnapshot = undefined
    tab.domChangesRecording = undefined
    tab.liveRegionRecording = undefined
    access.changed(false)
  })
  webContents.on('page-favicon-updated', (_event, favicons) => {
    if (tab.sleeping) return
    void access.loadFavicon(tab, favicons)
  })
  // Observe only. Without preventDefault Electron cancels the challenge, so
  // no credentials are requested, supplied or retried.
  webContents.on('login', (_event, details, authInfo) => access.recordAuthChallenge(tab, details, authInfo))
  webContents.on('audio-state-changed', (event) => {
    tab.audible = event.audible
    tab.muted = webContents.isAudioMuted()
    access.changed(false)
  })
  webContents.on('did-stop-loading', () => {
    // An aborted provisional load still stops loading without a commit.
    if (!webContents.isLoadingMainFrame()) tab.authNavigationPending = false
    if (tab.sleeping) return
    access.reconcileTabPresentation(tab)
    syncNavigation()
    access.reproRecorder().refreshReproScrollPosition(tab)
    access.scheduleTabOverviewPreview(tab)
    if (tab.suppressInitialHistory) {
      tab.suppressInitialHistory = false
      tab.pendingHistoryUrl = null
      return
    }
    recordPendingHistory()
    tab.pendingHistoryUrl = null
  })
  webContents.on('did-navigate', (_event, url) => {
    tab.authNavigationPending = false
    // A navigation may already have started before emulation admission.
    tab.emulationContextGeneration++
    if (tab.sleeping) return
    // Reset only when a new main-frame document commits, never on a failed load.
    tab.performanceDocumentRouted = false
    access.trackWorkspaceOrigin(tab, url)
    tab.memoryBaseline = undefined
    const previousUrl = tab.url
    try {
      if (new URL(previousUrl).origin !== new URL(url).origin) {
        tab.storageComparison = undefined
      }
    } catch {
      tab.storageComparison = undefined
      tab.faviconDataUrl = undefined
    }
    if (previousUrl !== url) tab.faviconDataUrl = undefined
    tab.pendingHistoryUrl = isWebUrl(url) ? url : null
    syncNavigation()
    access.reproRecorder().navigated(tab, url, false)
  })
  webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (tab.sleeping) return
    access.trackWorkspaceOrigin(tab, url)
    // A frame's hash or history change does not represent another visit to
    // the tab's top-level page.
    if (!isMainFrame) return
    tab.performanceDocumentRouted = true
    syncNavigation()
    access.reproRecorder().navigated(tab, url, true)
    if (!tab.suppressInitialHistory) access.recordVisit(tab)
    tab.pendingHistoryUrl = null
    access.scheduleTabOverviewPreview(tab)
  })
  webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (tab.sleeping) return
    const previousUrl = tab.url
    syncNavigation()
    if (!isMainFrame || errorCode === ABORTED_LOAD_ERROR) return
    tab.authNavigationPending = false
    const failedUrl = validatedURL || tab.url
    tab.loading = false
    if (previousUrl !== failedUrl) tab.faviconDataUrl = undefined
    tab.url = failedUrl
    tab.title = 'Site unavailable'
    tab.pageProblem = loadFailureProblem(access.options().getLocale(), failedUrl, errorCode, errorDescription)
    access.appendConsoleMessage(tab, {
      timestamp: new Date().toISOString(),
      level: 'error',
      message: `Page load failed: ${errorDescription} (${errorCode})`,
      lineNumber: 0,
      sourceId: failedUrl,
      kind: 'lifecycle'
    }, 'lifecycle')
    access.changed()
    access.scheduleTabOverviewPreview(tab)
  })
  webContents.on('dom-ready', () => {
    // A page can remain loading indefinitely because of a slow image,
    // analytics request, or other subresource. Once its main document is
    // committed and usable, make it available to address suggestions rather
    // than waiting for did-stop-loading.
    recordPendingHistory()
    access.watchCredentialSubmission(tab)
    access.watchUnsavedFormEdits(tab)
    void access.syncHumanInteractionInputGuard(tab).catch((error) => {
      console.error('[browser] Could not synchronize the page interaction lock:', error)
    })
  })
  webContents.on('did-frame-finish-load', () => {
    if (!access.isHumanInteractionLocked(tab)) return
    void access.syncHumanInteractionInputGuard(tab).catch((error) => {
      console.error('[browser] Could not synchronize a frame interaction lock:', error)
    })
  })
}
