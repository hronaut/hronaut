import type { Event, WebContents, WebFrameMain } from 'electron'
import type { MessageKey } from '../../../shared/i18n.js'
import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { pageLoadTimedOut } from '../http-auth/http-auth.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { liveRegionRecordingKeepsTabAwake } from '../live-region-recorder.js'
import { localizedLoadFailure } from '../load-failure-error.js'
import type { NavigationHistorySnapshot } from '../navigation-history.js'
import { settledWithin } from '../page-waits/page-load-limit.js'
import { firstLoadStarts, RendererExitedError } from '../renderer-exit-guard.js'
import { holdTabHistory } from '../tab-history-pages/forget-tab-history-pages.js'
import { isHronautHomeUrl, isWebUrl } from '../url.js'
import { SLEEPING_PAGE_URL } from './sleeping-page.js'
import type { Browser } from '../browser.js'
import { ensureDialogMonitoring } from '../website-dialogs/website-dialogs.js'
import { findTab, getTab, orderedTabs } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'

// A copy of the tab manager's own check, which its load handling keeps using.
const ABORTED_LOAD_ERROR = -3

/**
 * The tab's first page starts to load: the renderer exit guard lets page calls through, website dialogs are watched,
 * and the person's input lock holds from the first document.
 */
function startFirstLoad(browser: Browser, tab: BrowserTab): void {
  firstLoadStarts(tab.webContents)
  void ensureDialogMonitoring(browser, tab)
  // The browser process applies the input lock without the page's renderer, so it holds from the first document
  // rather than once the page's monitoring is in place.
  if (browser.isHumanInteractionLocked(tab) && tab.webContents.debugger.isAttached()) {
    void tab.webContents.debugger.sendCommand('Input.setIgnoreInputEvents', { ignore: true }).catch(() => undefined)
  }
}

function isAbortedLoad(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const details = error as Error & { code?: unknown; errno?: unknown }
  return details.code === ABORTED_LOAD_ERROR
    || details.errno === ABORTED_LOAD_ERROR
    || details.code === 'ERR_ABORTED'
    || /\bERR_ABORTED\b|\(-3\)\s+loading\b/.test(error.message)
}

/**
 * Whether the tab shows a page of its own: neither the sleeping page nor, for a tab created asleep, nothing yet.
 */
function showsPage(webContents: WebContents): boolean {
  const url = webContents.getURL()
  return url !== '' && url !== SLEEPING_PAGE_URL
}

/**
 * The tab's history without the sleeping page, which a tab that wakes keeps after its own page until that page loads,
 * so Back and Forward, Duplicate and Reopen closed tab never lead to it. The page the tab shows stays.
 */
export function withoutSleepingPage(history: NavigationHistorySnapshot): NavigationHistorySnapshot {
  const kept = (entry: { url: string }) => entry.url !== SLEEPING_PAGE_URL
  if (history.entries.every(kept)) return history
  return {
    entries: history.entries.filter((entry, index) => index === history.index || kept(entry)),
    index: history.entries.slice(0, history.index).filter(kept).length
  }
}

/**
 * Starts a load with start and settles as Electron's `loadURL` does: once the page, or the error page of a failed load,
 * finishes loading, with the load's error when it failed; as aborted when another navigation replaces it or the tab
 * closes; and as failed when loading stops without either. A load start refuses by throwing settles with that error.
 */
function settledAsLoad(webContents: WebContents, url: string, start: () => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let navigationStarted = false
    let failure: Error | undefined
    const loadError = (code: number, description: string) =>
      Object.assign(new Error(`${description} (${code}) loading '${url}'`), { errno: code, code: description, url })
    const finished = () => settle(failure)
    // A failed load goes on to show its error page; settling only once that page loads keeps its load events from
    // settling the next one, such as the wake's fallback.
    const failed = (_event: Event, code: number, description: string, _validatedUrl: string, isMainFrame: boolean) => {
      if (!isMainFrame) return
      failure ??= loadError(code, description)
      if (!navigationStarted) settle(failure)
    }
    const started = (_event: Event, _navigationUrl: string, isSameDocument: boolean, isMainFrame: boolean) => {
      if (!isMainFrame || isSameDocument) return
      if (navigationStarted) settle(loadError(-3, 'ERR_ABORTED'))
      navigationStarted = true
    }
    const stopped = () => settle(failure ?? loadError(-2, 'ERR_FAILED'))
    const closed = () => settle(loadError(-3, 'ERR_ABORTED'))
    function settle(error?: Error): void {
      webContents.removeListener('did-finish-load', finished)
      webContents.removeListener('did-fail-load', failed)
      webContents.removeListener('did-start-navigation', started)
      webContents.removeListener('did-stop-loading', stopped)
      webContents.removeListener('destroyed', closed)
      if (error) reject(error)
      else resolve()
    }
    webContents.on('did-finish-load', finished)
    webContents.on('did-fail-load', failed)
    webContents.on('did-start-navigation', started)
    webContents.on('did-stop-loading', stopped)
    webContents.on('destroyed', closed)
    try {
      start()
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

/**
 * Goes back from the sleeping page to the page the tab slept on, so the tab keeps the pages before it in its history:
 * Electron restores saved history only into a page that never loaded one, and the sleeping page is one. When the
 * sleeping page is not the current entry right after the tab's address, the address is loaded instead. It settles as
 * Electron's `loadURL` does.
 */
function returnFromSleepingPage(webContents: WebContents, url: string): Promise<void> {
  const history = webContents.navigationHistory
  const sleepingIndex = history.getActiveIndex()
  if (history.getEntryAtIndex(sleepingIndex)?.url !== SLEEPING_PAGE_URL || history.getEntryAtIndex(sleepingIndex - 1)?.url !== url) {
    return webContents.loadURL(url)
  }
  return settledAsLoad(webContents, url, () => history.goToIndex(sleepingIndex - 1))
}

/**
 * Loads the page of a tab created asleep, which never loaded one, with the pages before and after it in its history and
 * where it was scrolled. A history that holds nothing but the address, such as that of a tab Open all opened, loads the
 * address as a new page, as when the tab loads at once. When Electron refuses the history, the address loads alone. It
 * settles as Electron's `loadURL` does.
 */
async function loadFirstPage(webContents: WebContents, url: string, history: NavigationHistorySnapshot | undefined): Promise<void> {
  const shown = history?.entries[history.index]
  if (!history || shown?.url !== url || (history.entries.length === 1 && !shown.pageState)) return webContents.loadURL(url)
  let refused = false
  try {
    await settledAsLoad(webContents, url, () => {
      try {
        // Its own promise settles only once a page finishes or fails loading, also when another navigation replaced it.
        void webContents.navigationHistory.restore(history).catch(() => undefined)
      } catch (error) {
        refused = true
        throw error
      }
    })
  } catch (error) {
    if (!refused || webContents.isDestroyed()) throw error
    console.warn('[browser] Could not restore the history of a tab created asleep:', error)
    await webContents.loadURL(url)
  }
}

/** Removes the sleeping page from the tab's history once the tab shows another page, so Back never opens it. */
function forgetSleepingPage(webContents: WebContents): void {
  const history = webContents.navigationHistory
  for (let index = history.length() - 1; index >= 0; index -= 1) {
    if (index !== history.getActiveIndex() && history.getEntryAtIndex(index)?.url === SLEEPING_PAGE_URL) history.removeEntryAtIndex(index)
  }
}

/**
 * Removes the sleeping page from the history once the navigation that replaced a wake opens its page; until then the
 * sleeping page is still the last page the tab committed and cannot be removed.
 */
function forgetSleepingPageOnNextPage(browser: Browser, tab: BrowserTab): void {
  const contents = tab.webContents
  if (findTab(browser, tab.id) !== tab || contents.isDestroyed()) return
  contents.once('did-navigate', () => {
    if (findTab(browser, tab.id) === tab && tab.webContents === contents && !contents.isDestroyed()) forgetSleepingPage(contents)
  })
}

/**
 * Wakes a sleeping tab by going back to the page it slept on, loading the
 * page of a tab created asleep with its history, or loading its address, and
 * marks it active now. A wake already running is joined. When that fails and
 * no newer navigation took over, the address is loaded again; when that fails
 * too, the tab is awake on the error page that load showed, or, if it still
 * shows no page of its own, goes back to sleep and the failure is thrown.
 * Once awake, the sleeping page leaves its history.
 */
export async function wakeTab(browser: Browser, tabId: string): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  tab.lastActiveAt = Date.now()
  if (tab.wakePromise) {
    await awaitWake(tab, tab.wakePromise)
    return browserState(browser)
  }
  if (!tab.sleeping) return browserState(browser)
  // Its callers went on with the page it showed, which an agent may already use.
  const handedOver = (): boolean => shownWakes.has(wake)
  const wake = (async () => {
    // A tab restored asleep wakes once its workspace's session cookies are back, from the tab as it is then.
    if (tab.pageReady) {
      await tab.pageReady
      tab.pageReady = undefined
      if (findTab(browser, tab.id) !== tab || tab.webContents.isDestroyed() || !tab.sleeping) return
    }
    const restoreUrl = tab.url
    // Clearing the history while the tab wakes also reaches the history it goes back to sleep with if waking fails.
    const navigationHistory = holdTabHistory(tab.sleepNavigationHistory)
    const previousLoading = tab.loading
    const previousSuppressInitialHistory = tab.suppressInitialHistory
    const navigationGeneration = tab.navigationGeneration
    // A tab opened to load in its turn loads its page for the first time, which is a visit as when it loads at once.
    const firstLoad = tab.waitsForTurn === true
    tab.waitsForTurn = false
    tab.sleeping = false
    browser.tabOverviewSleepPreviews.delete(tab.id)
    tab.sleepNavigationHistory = undefined
    tab.loading = true
    if (!firstLoad) tab.suppressInitialHistory = true
    publishChange(browser, false)
    try {
      // A tab created asleep never loaded a page, so it has had no renderer process until now, as in Chrome.
      if (tab.webContents.getURL() === '') {
        startFirstLoad(browser, tab)
        await loadFirstPage(tab.webContents, restoreUrl, navigationHistory)
      } else {
        await returnFromSleepingPage(tab.webContents, restoreUrl)
      }
    } catch (error) {
      if (handedOver()) return
      const wakeWasSuperseded = () => findTab(browser, tab.id) !== tab
        || tab.webContents.isDestroyed()
        || (tab.navigationGeneration !== navigationGeneration
          && (tab.webContents.isLoading() || showsPage(tab.webContents)))
      // A wake that ended as aborted without a newer navigation retries the
      // durable URL; otherwise the tab is marked awake while still showing
      // no page of its own. A real newer navigation remains
      // authoritative, and the sleeping page leaves the history once that
      // navigation's page opens.
      if (isAbortedLoad(error) && wakeWasSuperseded()) {
        forgetSleepingPageOnNextPage(browser, tab)
        return
      }
      try {
        await tab.webContents.loadURL(restoreUrl)
      } catch (fallbackError) {
        if (handedOver()) return
        // A newer navigation can also interrupt the fallback. Preserve its
        // live document instead of restoring the obsolete sleeping state.
        if (isAbortedLoad(fallbackError) && wakeWasSuperseded()) {
          forgetSleepingPageOnNextPage(browser, tab)
          return
        }
        // A website that cannot be reached, such as a stopped local server, leaves the tab on Chromium's error page at
        // its address, or at the address it redirected to, as Chrome shows a discarded tab: the tab is awake there,
        // and Reload tries again. A load that commits nothing, such as a download, leaves the tab without a page.
        if (findTab(browser, tab.id) === tab && !tab.webContents.isDestroyed() && showsPage(tab.webContents)) {
          forgetSleepingPage(tab.webContents)
          return
        }
        if (findTab(browser, tab.id) === tab) {
          tab.sleeping = true
          tab.sleepNavigationHistory = navigationHistory
          tab.loading = previousLoading
          tab.suppressInitialHistory = previousSuppressInitialHistory
          publishChange(browser, false)
        }
        throw localizedLoadFailure(fallbackError)
      }
    }
    if (findTab(browser, tab.id) === tab && !tab.webContents.isDestroyed()) forgetSleepingPage(tab.webContents)
  })()
  tab.wakePromise = wake
  const settled = (): void => { if (tab.wakePromise === wake) tab.wakePromise = undefined }
  wake.then(settled, settled)
  await awaitWake(tab, wake)
  return browserState(browser)
}

/** Wakes whose callers went on once their page showed, while its load went on. */
const shownWakes = new WeakSet<Promise<void>>()

/**
 * Waits for a wake. A page whose load never ends, such as one with an image its server never answers, holds the
 * caller only for PAGE_LOAD_WAIT_MS: once the page shows, the tab is awake and keeps loading, as in Chrome, and the
 * sleeping page leaves its history; while it still shows no page of its own, the wait fails.
 */
async function awaitWake(tab: BrowserTab, wake: Promise<void>): Promise<void> {
  if (await settledWithin(wake)) return
  if (!tab.webContents.isDestroyed() && showsPage(tab.webContents)) {
    shownWakes.add(wake)
    forgetSleepingPage(tab.webContents)
    // The wake is over for every caller, while the page goes on loading. The load of a page it loads again is not a
    // visit, and the next page's is; a first load stays a visit, recorded once the page loaded.
    if (tab.wakePromise === wake) tab.wakePromise = undefined
    if (tab.suppressInitialHistory) {
      tab.suppressInitialHistory = false
      tab.pendingHistoryUrl = null
    }
    return
  }
  throw pageLoadTimedOut(tab.webContents)
}

/** Puts the tab to sleep, reporting what keeps it awake, or wakes it. */
export async function setTabSleeping(browser: Browser, tabId: string, sleeping: boolean): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  if (sleeping) await putTabToSleep(browser, tab, true)
  else await wakeTab(browser, tabId)
  return browserState(browser)
}

/**
 * The tab to show instead when the active tab goes to sleep, looking after it
 * and then before it: an awake tab of its workspace, then a sleeping one there,
 * so the person stays in the workspace, then an awake tab of another
 * workspace, then any.
 */
export function sleepFallbackTab(browser: Browser, tab: BrowserTab): BrowserTab | undefined {
  const ordered = orderedTabs(browser)
  const index = ordered.indexOf(tab)
  const candidates = [
    ...ordered.slice(index + 1),
    ...ordered.slice(0, index).reverse()
  ].filter((candidate) => candidate.id !== tab.id && !candidate.webContents.isDestroyed())
  const sameWorkspace = candidates.filter((candidate) => candidate.mcpGroupId === tab.mcpGroupId)
  return sameWorkspace.find((candidate) => !candidate.sleeping)
    ?? sameWorkspace[0]
    ?? candidates.find((candidate) => !candidate.sleeping)
    ?? candidates[0]
}

/**
 * Puts the tab to sleep or wakes it from its context menu. An active tab
 * that may sleep first hands the view to its fallback tab, and gets it back
 * when going to sleep fails.
 */
export async function setTabSleepingFromContextMenu(browser: Browser, tabId: string, sleeping: boolean): Promise<void> {
  const tab = getTab(browser, tabId)
  if (!sleeping) {
    await wakeTab(browser, tab.id)
    return
  }
  if (tab.sleeping) return

  const active = tab.id === browser.activeTabId && !browser.splitViewContains(tab.id)
  const fallback = active ? sleepFallbackTab(browser, tab) : undefined
  const blockReason = sleepBlockReason(browser, tab, active && fallback !== undefined)
  if (blockReason) throw new LocalizedError(blockReason)
  if (!active || !fallback) {
    await putTabToSleep(browser, tab, true)
    return
  }

  // What the page holds keeps it awake before the view moves, so a refusal neither switches tabs nor wakes the fallback.
  const pageHold = await pageSleepHold(tab)
  if (pageHold) throw new LocalizedError(pageHold)
  if (browser.activeTabId !== tab.id || browser.splitViewContains(tab.id)) {
    await putTabToSleep(browser, tab, true)
    return
  }
  const latestFallback = sleepFallbackTab(browser, tab)
  const latestBlockReason = sleepBlockReason(browser, tab, latestFallback !== undefined)
  if (latestBlockReason) throw new LocalizedError(latestBlockReason)
  if (!latestFallback) throw new LocalizedError('appErrors.sleep.visible')
  browser.selectTab(latestFallback.id)
  try {
    await putTabToSleep(browser, tab, true)
  } catch (error) {
    if (browser.tabs.has(tab.id) && !tab.webContents.isDestroyed() && browser.activeTabId === latestFallback.id) {
      browser.selectTab(tab.id)
    }
    throw error
  }
}

/** Puts every tab of the workspace that may sleep to sleep, skipping the others. */
export async function sleepWorkspaceTabs(browser: Browser, groupId: string): Promise<void> {
  if (!browser.mcpTabGroups.has(groupId)) throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${groupId}` })
  const workspaceTabs = [...browser.tabs.values()].filter((tab) => tab.mcpGroupId === groupId)
  for (const tab of workspaceTabs) await putTabToSleep(browser, tab, false)
}

/**
 * The message key of why the tab must stay awake, in words for the person, or
 * undefined when it may sleep. The active tab may sleep only when
 * allowActiveTab says another tab will take its place.
 */
export function sleepBlockReason(browser: Browser, tab: BrowserTab, allowActiveTab = false): MessageKey | undefined {
  if (!browser.tabs.has(tab.id) || tab.webContents.isDestroyed()) return 'native.errors.tabUnavailable'
  if (isHronautHomeUrl(tab.url) || !isWebUrl(tab.url)) return 'appErrors.sleep.onlyWebsites'
  if ((!allowActiveTab && tab.id === browser.activeTabId) || browser.splitViewContains(tab.id)) return 'appErrors.sleep.visible'
  if (tab.pinned) return 'appErrors.sleep.pinned'
  if (tab.pageLifecycleState !== 'active' || tab.pageLifecycleOperation) return 'appErrors.sleep.pageHold'
  if (tab.loading) return 'appErrors.sleep.loading'
  if (tab.audible) return 'appErrors.sleep.audio'
  if (tab.dialog) return 'appErrors.sleep.dialog'
  if (browser.options.walletKeepsTabAwake?.(tab.id)) return 'appErrors.sleep.wallet'
  if (tab.webContents.isDevToolsOpened() || browser.devToolsOpening.has(tab.webContents.id)) {
    return 'appErrors.sleep.devTools'
  }
  if (
    browser.screenshotAreaSessions.has(tab.webContents.id)
    || browser.elementPickerSessions.has(tab.webContents.id)
    || browser.agentInputWebContents.has(tab.webContents.id)
  ) {
    return 'appErrors.sleep.interaction'
  }
  if (browser.videoRecorder.state(tab.id).status === 'recording') return 'appErrors.sleep.video'
  if (tab.reproRecording?.active) return 'appErrors.sleep.repro'
  if (tab.domChangesRecording?.active) return 'appErrors.sleep.domChanges'
  if (liveRegionRecordingKeepsTabAwake(tab)) return 'appErrors.sleep.liveRegion'
  if (browser.cssStatePreview.active(tab)) return 'appErrors.sleep.cssState'
  if (browser.domMutationSource.active(tab)) return 'appErrors.sleep.domMutationSource'
  if (browser.virtualPasskeys.active(tab)) return 'appErrors.sleep.passkey'
  if (browser.logpoints.active(tab)) return 'appErrors.sleep.logpoints'
  if (tab.codeCoverage?.recording) return 'appErrors.sleep.coverage'
  if (tab.cpuProfile?.recording) return 'appErrors.sleep.cpuProfile'
  if (tab.memoryAllocation?.recording) return 'appErrors.sleep.memory'
  if ((browser.mcpActivitiesByTab.get(tab.id)?.size ?? 0) > 0) return 'appErrors.sleep.mcpCommand'
  if (browser.downloadController.hasActiveDownload(tab.id)) {
    return 'appErrors.sleep.download'
  }
  if (browser.renderQueues.has(tab.webContents.id)) return 'appErrors.sleep.render'
  // Sleeping replaces the page, which would break what the two pages are doing together, such as signing in.
  if ((tab.openerTabId && browser.tabs.has(tab.openerTabId)) || [...browser.tabs.values()].some(other => other.openerTabId === tab.id)) {
    return 'appErrors.sleep.window'
  }
  return undefined
}

/**
 * Whether one document holds form input the person changed, including fields inside open shadow roots, or edited
 * content its watcher recorded.
 */
const CHANGED_FORM_STATE_SCRIPT = `(() => {
    const changed = (field) => {
      if (field instanceof HTMLInputElement) {
        const type = (field.getAttribute('type') || 'text').toLowerCase();
        if (['button', 'submit', 'reset', 'image', 'hidden'].includes(type)) return false;
        if (type === 'checkbox' || type === 'radio') return field.checked !== field.defaultChecked;
        if (type === 'file') return (field.files?.length || 0) > 0;
        return field.value !== field.defaultValue;
      }
      if (field instanceof HTMLTextAreaElement) return field.value !== field.defaultValue;
      if (field instanceof HTMLSelectElement) {
        if (field.multiple) return [...field.options].some((option) => option.selected !== option.defaultSelected);
        const explicitDefault = [...field.options].findIndex((option) => option.defaultSelected);
        const defaultIndex = explicitDefault >= 0 ? explicitDefault : field.options.length > 0 ? 0 : -1;
        return field.selectedIndex !== defaultIndex;
      }
      return false;
    };
    const roots = [document];
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (changed(element)) return true;
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }
    return window.__hronautContentEditableDirty === true;
  })()`

/** How long an embedded frame has to answer the page checks, so a busy or vanishing frame cannot hold up sleeping. */
const FRAME_CHECK_TIMEOUT_MS = 1_000

/**
 * Whether a video of the document shows in Picture in picture, or the document opened a Picture in picture window of
 * its own; a video in a shadow root shows as its root's host. A document without these APIs shows none.
 */
const PICTURE_IN_PICTURE_SCRIPT = "document.pictureInPictureElement != null || (typeof documentPictureInPicture === 'object' && documentPictureInPicture?.window != null)"

/**
 * What in the page keeps the tab awake, as the message saying so, or undefined when nothing does: form input the person
 * changed, including edited content, which sleeping would lose, or a video shown in Picture in picture, which the
 * sleeping page would close, as Chrome never discards such a tab. Every frame is read, since a draft or a player can be
 * embedded. The page's own frame answers both at once: the forms in the page's world, where its watcher records edited
 * content, and Picture in picture in a world of its own, which the page cannot change. A page that cannot answer the
 * form check counts as changed, except one whose renderer exited, which holds no input; one that cannot answer the other
 * shows none. A frame inside the page answers both at once in its page's world, the only one Electron runs scripts in
 * there; one that cannot answer in time, such as one not allowed to run scripts, is skipped, so it cannot hold up
 * sleeping or keep the tab awake for good.
 */
export async function pageSleepHold(tab: BrowserTab): Promise<MessageKey | undefined> {
  const [changed, shown] = await Promise.all([
    tab.webContents.executeJavaScript(CHANGED_FORM_STATE_SCRIPT).then(
      (answer: unknown) => answer === true,
      (error: unknown) => !(error instanceof RendererExitedError)
    ),
    tab.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLDS.tabSleep, [{ code: PICTURE_IN_PICTURE_SCRIPT }]).then(
      (answer: unknown) => answer === true,
      () => false
    )
  ])
  if (changed) return 'appErrors.sleep.unsavedForm'
  if (shown) return 'appErrors.sleep.pictureInPicture'
  if (tab.webContents.isDestroyed()) return undefined
  for (const frame of tab.webContents.mainFrame.framesInSubtree) {
    if (frame === tab.webContents.mainFrame || frame.isDestroyed() || frame.detached) continue
    const [frameChanged, frameShown] = await Promise.all([
      frameAnswer(frame.executeJavaScript(CHANGED_FORM_STATE_SCRIPT)),
      frameAnswer(frame.executeJavaScript(PICTURE_IN_PICTURE_SCRIPT))
    ])
    if (frameChanged === true) return 'appErrors.sleep.unsavedForm'
    if (frameShown === true) return 'appErrors.sleep.pictureInPicture'
  }
  return undefined
}

/** The frame's answer, or undefined when it fails or does not answer in time. */
async function frameAnswer(call: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), FRAME_CHECK_TIMEOUT_MS) })
  try {
    return await Promise.race([call.catch(() => undefined), late])
  } finally {
    clearTimeout(timer)
  }
}

/** Records in a document whether the person edits editable content, which forms do not show, inside shadow roots too. */
const WATCH_FORM_EDITS_SCRIPT = `(() => {
    if (window.__hronautFormEditTrackingInstalled) return;
    window.__hronautFormEditTrackingInstalled = true;
    window.__hronautContentEditableDirty = false;
    document.addEventListener('input', (event) => {
      const target = event.composedPath()[0];
      if (target instanceof HTMLElement && target.isContentEditable) {
        window.__hronautContentEditableDirty = true;
      }
    }, true);
  })()`

/**
 * Starts recording in the page, or in one of its frames once it loads, whether the person edits editable content,
 * which forms do not show. Adding a listener needs no user activation, so none is granted: activation would let the
 * page, or an embedded frame and every page above it, act as if the person had just clicked.
 */
export function watchUnsavedFormEdits(tab: BrowserTab, frame?: WebFrameMain): void {
  const run = frame ? frame.executeJavaScript(WATCH_FORM_EDITS_SCRIPT, false) : tab.webContents.executeJavaScript(WATCH_FORM_EDITS_SCRIPT, false)
  void run.catch(() => undefined)
}

/** How long the first wake of a tab restored asleep waits for its workspace's session cookies. */
export const FIRST_WAKE_WAIT_MS = 10_000

/**
 * Keeps a new tab whose own page has not loaded, such as a tab restored behind the one shown, without any page until it
 * wakes, as Chrome restores them: it then has no renderer process, and wakes when it is shown or used, with its
 * history. Returns what its first wake waits for: what its page waits for before it loads, for FIRST_WAKE_WAIT_MS at
 * most.
 */
export function sleepBeforeFirstLoad(pageCanLoad: Promise<void>): Promise<void> {
  return settledWithin(pageCanLoad.catch(() => undefined), FIRST_WAKE_WAIT_MS).then(() => undefined)
}

/**
 * Puts the tab to sleep: it keeps its history and overview frame, and its
 * page is replaced by the sleeping page, freeing its memory. It checks what
 * keeps the tab awake again after reading the page, and stops when
 * isCurrent says the request is no longer wanted. A failure that reportBlocked
 * leaves unthrown is logged. When the sleeping page loaded but its cleanup
 * failed, the previous page is restored; when that fails too, the tab stays
 * asleep. Returns whether the tab went to sleep.
 */
export async function putTabToSleep(browser: Browser, tab: BrowserTab, reportBlocked: boolean, isCurrent: () => boolean = () => true): Promise<boolean> {
  if (tab.wakePromise) {
    try {
      await awaitWake(tab, tab.wakePromise)
    } catch (error) {
      // The tab still shows the sleeping page while its wake goes on.
      if (reportBlocked) throw error
      return false
    }
  }
  if (!isCurrent()) return false
  if (tab.sleeping) {
    // A tab still waiting to load in its turn stays asleep.
    tab.waitsForTurn = false
    return false
  }
  const blockReason = sleepBlockReason(browser, tab)
  if (blockReason) {
    if (reportBlocked) throw new LocalizedError(blockReason)
    return false
  }
  const pageHold = await pageSleepHold(tab)
  if (pageHold) {
    if (reportBlocked) throw new LocalizedError(pageHold)
    return false
  }
  if (!isCurrent()) return false
  const latestBlockReason = sleepBlockReason(browser, tab)
  if (latestBlockReason) {
    if (reportBlocked) throw new LocalizedError(latestBlockReason)
    return false
  }
  tab.sleepNavigationHistory = browser.navigationHistorySnapshot(tab)
  // The overview keeps showing the page as it was; the frame is dropped when the tab wakes or closes.
  const lastFrame = browser.tabOverviewPreviews.get(tab.id)
  if (lastFrame?.navigationGeneration === tab.navigationGeneration) browser.tabOverviewSleepPreviews.set(tab.id, lastFrame)
  else browser.tabOverviewSleepPreviews.delete(tab.id)
  tab.sleeping = true
  tab.walletPageUnloading = true
  tab.loading = false
  tab.pendingHistoryUrl = null
  publishChange(browser, false)
  let sleepingPageLoaded = false
  try {
    try {
      await tab.webContents.loadURL(SLEEPING_PAGE_URL)
    } finally {
      // The page is gone now, or the navigation failed and it stays in use.
      tab.walletPageUnloading = false
    }
    sleepingPageLoaded = true
    await withDebugger(browser, tab.webContents, () =>
      tab.webContents.debugger.sendCommand('HeapProfiler.collectGarbage')
    )
  } catch (error) {
    const navigationHistory = tab.sleepNavigationHistory
    if (!sleepingPageLoaded) {
      tab.sleeping = false
      tab.sleepNavigationHistory = undefined
      publishChange(browser, false)
      if (reportBlocked) throw error
      console.warn(`[browser] Could not put tab ${tab.id} to sleep:`, error)
      return false
    }
    let restoreError: unknown
    // Awake while its page returns, as waking does, so the page's own redirects still go through.
    tab.sleeping = false
    try {
      try {
        await returnFromSleepingPage(tab.webContents, tab.url)
      } catch {
        await tab.webContents.loadURL(tab.url)
      }
      forgetSleepingPage(tab.webContents)
    } catch (rollbackError) {
      restoreError = rollbackError
    }
    if (restoreError) {
      tab.sleeping = true
      tab.sleepNavigationHistory = navigationHistory
      tab.loading = false
      publishChange(browser, false)
      const recoveryError = new AggregateError(
        [error, restoreError],
        'The tab could not finish sleeping and its previous page could not be restored.'
      )
      if (reportBlocked) throw recoveryError
      console.warn(`[browser] Could not put tab ${tab.id} to sleep or restore it:`, recoveryError)
      return false
    }
    tab.sleeping = false
    tab.sleepNavigationHistory = undefined
    tab.loading = false
    publishChange(browser, false)
    if (reportBlocked) throw error
    console.warn(`[browser] Could not put tab ${tab.id} to sleep:`, error)
    return false
  }
  publishChange(browser, false)
  return true
}
