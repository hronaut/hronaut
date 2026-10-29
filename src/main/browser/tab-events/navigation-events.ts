import type { WebContents } from 'electron'
import { translate } from '../../../shared/i18n.js'
import { retireNetworkPriorityObservations } from '../network-recording.js'
import { loadFailureProblem } from '../page-load-problem.js'
import { normalizeTabTitle } from '../tab-metadata.js'
import { isWebUrl } from '../url.js'
import type { NavigationEventsAccess, NavigationEventsTab } from './navigation-events-access.js'
import { isStaleAddressTitle, untitledPageTitle } from './untitled-page-title.js'

/** Chromium's error code for a load that was aborted, which shows no load failure. */
const ABORTED_LOAD_ERROR = -3

/**
 * As in Chrome, the history keeps the titles a page sets until its main frame finishes loading and in the 5 s after,
 * at most 10 for each page. A title a page sets later to get attention, such as a count of unread messages, a chat
 * message or a timer, stays out of the history, which a page changing its title every second no longer rewrites.
 */
const HISTORY_TITLE_WINDOW_MS = 5_000
const HISTORY_TITLE_CHANGES = 10
/** Chromium's limit of history entries for a tab, at which a new last entry takes the last index again. */
const MAX_TAB_HISTORY_ENTRIES = 50

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
  // A wallet request belongs to the document that made it, so its requests and network end when another document,
  // a page or an error page, replaces it. A navigation that never commits, such as a download or a response with no
  // content, keeps the page and its requests. Each replacement begins a page of its own, also when a newer navigation
  // has already started by then.
  const walletDocumentReplaced = (): void => {
    tab.walletNavigationGeneration += 1
    access.runWalletLifecycleAction('cancel wallet requests after tab navigation', () => (
      access.options().onWalletNavigation?.(tab.id, tab.walletNavigationGeneration)
    ))
  }
  // The history entry the page shows, and whether the document that committed last opened that entry again at its
  // address: a reload, or a navigation to the address the tab shows, which Chromium turns into one. Chrome does not
  // count a reload as another visit.
  let committedEntry = { index: -1, count: 0 }
  let pendingHistoryReload = false
  const withoutFragment = (address: string): string => address.split('#', 1)[0] ?? address
  const activeEntry = (): { index: number; count: number } => {
    try {
      return { index: webContents.navigationHistory.getActiveIndex(), count: webContents.navigationHistory.length() }
    } catch {
      return { index: -1, count: 0 }
    }
  }
  // Whether the active entry follows an entry at the address, as a route the page pushed from there does.
  const pushedFrom = (address: string): boolean => {
    try {
      const index = webContents.navigationHistory.getActiveIndex()
      return index > 0 && webContents.navigationHistory.getEntryAtIndex(index - 1)?.url === address
    } catch {
      return false
    }
  }
  // Whether the active entry is the one the page committed last. Only removing entries changes the history without a
  // navigation, such as Hronaut removing the sleeping page of a woken tab, which moves the entry one place back for
  // each entry removed before it. A tab with as many entries as Chromium keeps gives a new last entry the last index
  // again, so there only another address tells it from a reload.
  const committedEntryActive = (entry: { index: number; count: number }): boolean => {
    const removed = committedEntry.count - entry.count
    return entry.index >= 0 && removed >= 0 && entry.index <= committedEntry.index && entry.index >= committedEntry.index - removed
      && (entry.count < MAX_TAB_HISTORY_ENTRIES || entry.index < entry.count - 1)
  }
  // Title changes the history took for the page; whether its main frame is loading, as Chrome counts a change within
  // the page to another address too; and when the 5 s after it finished loading end.
  let historyTitleChanges = 0
  let mainFrameLoading = false
  let historyTitleWindowEnd = 0
  const mainFrameLoaded = (): void => {
    if (!mainFrameLoading) return
    mainFrameLoading = false
    historyTitleWindowEnd = Date.now() + HISTORY_TITLE_WINDOW_MS
  }
  // A restored, duplicated or waking tab loads its page again, which is not another visit. Only the first document that
  // load commits is that page: a page opened before the load ends, such as through a link while an image of the
  // restored page still loads, is a visit. Electron reports no other start of loading until this load stops.
  let suppressedDocumentCommitted = false
  const recordPendingHistory = (): void => {
    if (tab.suppressInitialHistory || tab.pendingHistoryUrl !== tab.url) return
    tab.title = normalizeTabTitle(webContents.getTitle(), tab.title)
    access.recordVisit(tab, pendingHistoryReload)
    tab.pendingHistoryUrl = null
  }
  webContents.on('page-title-updated', (_event, title, explicitSet) => {
    if (tab.sleeping) return
    tab.discoveryTitle.observe(title, explicitSet === true)
    const nextTitle = normalizeTabTitle(title, tab.title)
    const titleChanged = nextTitle !== tab.title
    tab.title = nextTitle
    if (titleChanged && historyTitleChanges < HISTORY_TITLE_CHANGES
      && (mainFrameLoading || Date.now() < historyTitleWindowEnd)) {
      historyTitleChanges += 1
      access.options().onPageTitleUpdated?.({
        url: webContents.getURL() || tab.url,
        title: nextTitle
      })
    }
    access.changed()
  })
  webContents.on('did-start-loading', () => {
    // The sleeping page's load starts here too, so a tab woken while that page still loads keeps the page it wakes to.
    suppressedDocumentCommitted = false
    if (tab.sleeping) return
    tab.loading = true
    tab.sleeping = false
    tab.lastActiveAt = Date.now()
    tab.pageProblem = undefined
    access.changed(false)
  })
  webContents.on('will-frame-navigate', (details) => {
    if (!details.isMainFrame) return
    // Hronaut wakes a sleeping tab without this event. A page that can reach the tab, such as the one that opened it
    // as a window, may not load another page into it unseen.
    if (tab.sleeping) {
      details.preventDefault()
      return
    }
    if (tab.mcpGroupId
      && !access.workspaceNavigationAllowed(tab.mcpGroupId, details.url, 'page')) {
      tab.navigationPolicyDenialSequence += 1
      details.preventDefault()
      return
    }
    access.prepareDiagnosticNavigation(tab)
  })
  webContents.on('will-redirect', (details) => {
    if (!details.isMainFrame) return
    if (tab.mcpGroupId && !access.workspaceNavigationAllowed(tab.mcpGroupId, details.url, 'redirect')) {
      tab.navigationPolicyDenialSequence += 1
      details.preventDefault()
      return
    }
    tab.pendingMainFrameUrl = details.url
  })
  webContents.on('did-start-navigation', (_event, navigationUrl, isSameDocument, isMainFrame) => {
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
    if (!isSameDocument) tab.documentGeneration += 1
    if (isSameDocument) {
      tab.performanceDocumentRouted = true
      return
    }
    tab.pendingMainFrameUrl = navigationUrl
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
    if (!webContents.isLoadingMainFrame()) {
      tab.authNavigationPending = false
      tab.pendingMainFrameUrl = undefined
    }
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
    tab.pendingMainFrameUrl = undefined
    // A navigation may already have started before emulation admission.
    tab.emulationContextGeneration++
    if (tab.sleeping) return
    // Reset only when a new main-frame document commits, never on a failed load.
    tab.performanceDocumentRouted = false
    tab.documentGeneration += 1
    walletDocumentReplaced()
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
    if (tab.suppressInitialHistory) {
      // The page it loaded again was not a visit waiting to be recorded, so reloading it is not its first visit either.
      if (suppressedDocumentCommitted) {
        tab.suppressInitialHistory = false
        tab.pendingHistoryUrl = null
      }
      suppressedDocumentCommitted = true
    }
    // A reload before the page it reloads was recorded is still its first visit.
    const entry = activeEntry()
    const sameEntry = committedEntryActive(entry) && url === previousUrl
    pendingHistoryReload = sameEntry && (tab.pendingHistoryUrl !== previousUrl || pendingHistoryReload)
    committedEntry = entry
    historyTitleChanges = 0
    mainFrameLoading = true
    tab.pendingHistoryUrl = isWebUrl(url) ? url : null
    syncNavigation()
    // As in Chrome, each new document of a muted website starts muted, and one of another website has its sound back.
    if (access.applySiteMuting(tab)) access.changed(false)
    access.reproRecorder().navigated(tab, url, false)
  })
  webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (tab.sleeping) return
    access.trackWorkspaceOrigin(tab, url)
    // A frame's hash or history change does not represent another visit to
    // the tab's top-level page, though it can add an entry.
    const previousEntry = committedEntry
    committedEntry = activeEntry()
    if (!isMainFrame) return
    // No title update follows a change within the page. Chromium names an untitled page by its new address after
    // `history.pushState`, but after `history.replaceState` it keeps the old address, whose fragment can hold a
    // sign-in token, so the tab takes the new one. A title the page set itself stays.
    const previousUrl = tab.url
    const title = webContents.getTitle()
    const pageTitle = title.trim() !== '' && normalizeTabTitle(title) === tab.discoveryTitle.value
    tab.title = normalizeTabTitle(!pageTitle && isStaleAddressTitle(title, previousUrl, url) ? untitledPageTitle(url) : title, tab.title)
    tab.performanceDocumentRouted = true
    syncNavigation()
    access.reproRecorder().navigated(tab, url, true)
    // A change within the page that keeps its address, such as `history.replaceState(state, '')` saving a router's
    // state or scroll position, is not another visit. Chrome skips it too unless it follows a click or key press
    // within a few seconds; Hronaut never counts it. The first visit is still recorded when the document is ready.
    // This relies on tab.url holding the last committed address, which only syncNavigation sets here.
    if (url !== previousUrl) {
      // The history leaves out fragments, so a link to a section of a page it holds is not another visit to it. A visit
      // still waiting for its page to be ready, such as one a hash router gives `#/` first, is recorded now, as a visit.
      const visitPending = tab.pendingHistoryUrl === previousUrl
      const samePage = withoutFragment(url) === withoutFragment(previousUrl) && (!visitPending || pendingHistoryReload)
      // A route the page a tab loaded again pushes, such as through a link while an image still loads, is a page opened
      // from it: a new entry after the page's own. The page's own change of its address, such as a router replacing it
      // or adding `#/`, is still that page. Clearing the history can remove entries before the page's own meanwhile,
      // which moves it back, so the entry before a pushed route is the page it was pushed from.
      if (tab.suppressInitialHistory && (committedEntry.index > previousEntry.index || pushedFrom(previousUrl))
        && withoutFragment(url) !== withoutFragment(previousUrl)) {
        tab.suppressInitialHistory = false
      }
      if (!tab.suppressInitialHistory) access.recordVisit(tab, samePage)
      tab.pendingHistoryUrl = null
      // A route of a single-page app is a page of its own, whose title the app sets once it has shown it, such as after
      // a slow request. As in Chrome, its titles count as set while it loads, until a document finishes loading.
      historyTitleChanges = 0
      mainFrameLoading = true
    }
    access.scheduleTabOverviewPreview(tab)
  })
  // Electron reports an error page that replaced the document here, before did-fail-load. did-fail-load also reports a
  // document that committed and then failed to receive the rest of its content, such as after a reset connection, and
  // that document stays.
  webContents.on('did-fail-provisional-load', (_event, _errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (tab.sleeping || !isMainFrame) return
    walletDocumentReplaced()
  })
  webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // A newer navigation can start before the one it replaced reports its failure.
    if (isMainFrame && validatedURL === tab.pendingMainFrameUrl) tab.pendingMainFrameUrl = undefined
    if (tab.sleeping) return
    const previousUrl = tab.url
    syncNavigation()
    // A navigation that never commits, such as a download, aborts its load and leaves the page loading.
    if (isMainFrame && (errorCode !== ABORTED_LOAD_ERROR || validatedURL === webContents.getURL())) mainFrameLoaded()
    if (!isMainFrame || errorCode === ABORTED_LOAD_ERROR) return
    tab.authNavigationPending = false
    tab.documentGeneration += 1
    const failedUrl = validatedURL || tab.url
    tab.loading = false
    if (previousUrl !== failedUrl) tab.faviconDataUrl = undefined
    tab.url = failedUrl
    const locale = access.options().getLocale()
    tab.title = translate(locale, 'native.pageProblem.loadTabTitle')
    tab.pageProblem = loadFailureProblem(locale, failedUrl, errorCode, errorDescription)
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
  webContents.on('did-frame-navigate', (_event, _url, _httpResponseCode, _httpStatusText, isMainFrame) => {
    // A frame that loads another document after its first one adds an entry to the tab's history.
    if (!isMainFrame && !tab.sleeping) committedEntry = activeEntry()
  })
  webContents.on('did-finish-load', () => {
    // Electron reports the main frame's load only.
    if (!tab.sleeping) mainFrameLoaded()
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
  webContents.on('did-frame-finish-load', (_event, isMainFrame, frameProcessId, frameRoutingId) => {
    if (!isMainFrame && !tab.sleeping) {
      // An embedded form or editor can hold a draft too, so its frame records edits as the page does.
      try {
        const frame = webContents.mainFrame.framesInSubtree.find((candidate) => (
          candidate.processId === frameProcessId && candidate.routingId === frameRoutingId
        ))
        if (frame) access.watchUnsavedFormEdits(tab, frame)
      } catch {
        // The page's frames are already gone; there is nothing left to watch.
      }
    }
    if (!access.isHumanInteractionLocked(tab)) return
    void access.syncHumanInteractionInputGuard(tab).catch((error) => {
      console.error('[browser] Could not synchronize a frame interaction lock:', error)
    })
  })
}
