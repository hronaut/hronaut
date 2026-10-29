import { webContents as electronWebContents, type WebContents } from 'electron'
import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { pageLoadTimedOut } from '../http-auth/http-auth.js'
import { localizedLoadFailure } from '../load-failure-error.js'
import { PAGE_LOAD_WAIT_MS, settledWithin } from '../page-waits/page-load-limit.js'
import { RendererExitedError } from '../renderer-exit-guard.js'
import { keepSessionCookies } from '../session-cookies/saved-session-cookies.js'
import { isHronautHomeUrl, normalizeAddress } from '../url.js'
import type { Browser } from '../browser.js'
import { assertWorkspaceNavigationAllowed, workspaceNavigationAllowed } from '../workspace-navigation/workspace-navigation.js'
import { forgetTabsOpenedFrom } from '../link-tab-placement/link-tab-openers.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'

// A copy of the tab manager's own check, which its load and wake handling keep using.
const ABORTED_LOAD_ERROR = -3
// How long a failed load waits for Electron to report that the page's renderer exited.
const RENDERER_EXIT_REPORT_WAIT_MS = 100

function isAbortedLoad(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const details = error as Error & { code?: unknown; errno?: unknown }
  return details.code === ABORTED_LOAD_ERROR
    || details.errno === ABORTED_LOAD_ERROR
    || details.code === 'ERR_ABORTED'
    || /\bERR_ABORTED\b|\(-3\)\s+loading\b/.test(error.message)
}

/**
 * Follows the exits of a page's renderer that Electron reports while a load runs. A crashed page's load starts a new
 * renderer, so an exit before the load is not the load's.
 */
function watchRendererExit(webContents: WebContents): { reported(waitMs: number): Promise<boolean>; stop(): void } {
  let exited = false
  let exitReported: (() => void) | undefined
  const onRendererGone = (): void => {
    exited = true
    exitReported?.()
  }
  webContents.on('render-process-gone', onRendererGone)
  return {
    // Whether an exit was reported, waiting up to waitMs for one.
    reported: (waitMs) => (exited ? Promise.resolve(true) : new Promise<boolean>((resolve) => {
      const wait = setTimeout(() => resolve(exited), waitMs)
      exitReported = () => {
        clearTimeout(wait)
        resolve(true)
      }
    })),
    stop: () => {
      webContents.removeListener('render-process-gone', onRendererGone)
    }
  }
}

/**
 * Loads an address or search in the tab. An agent workspace cannot open Home,
 * and its navigation policy is checked before the load starts. A load that a
 * policy denial or an abort ended resolves; any other failure of the current
 * load throws. A load the page's renderer ended by exiting resolves for a
 * person, as the tab says its page stopped working, as Chrome does; an agent is
 * told the renderer exited, which a network error would not say. A page that
 * asks before it is left, as an editor with unsaved changes does, keeps itself
 * open: a person who started the load is asked, as Chrome asks "Leave site?",
 * and an agent gets an error saying so instead of a load that silently did not
 * happen.
 */
export async function navigate(browser: Browser, url: string, tabId?: string,
  options: { byPerson?: boolean } = {}): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  const normalized = normalizeAddress(url, browser.options.getSearchEngine?.())
  if (tab.mcpGroupId && isHronautHomeUrl(normalized)) {
    throw new LocalizedError('appErrors.navigation.homeInAgentWorkspace')
  }
  if (tab.mcpGroupId) {
    assertWorkspaceNavigationAllowed(browser, tab.mcpGroupId, normalized, 'direct')
    // A tab sent to another address starts a new task, so its workspace forgets which page opened which tab, as Chrome
    // does for a typed address.
    forgetTabsOpenedFrom(browser.tabs.values(), tab.mcpGroupId)
  }
  // A tab restored asleep loads nothing before its workspace's session cookies are back, and its wake loads first. A
  // sleeping tab wakes first, so the page the new one replaces is its own; one already waking is replaced, as a load
  // replaces the one before it in Chrome.
  if (tab.pageReady) await tab.pageReady
  if (tab.sleeping && !tab.wakePromise) await browser.wakeTab(tab.id)
  // A workspace's sites get the session cookies it saved at the last quit, as its first page does, which this load
  // then replaces.
  if (!isHronautHomeUrl(normalized)) await keepSessionCookies(tab.webContents.session)
  const webContents = tab.webContents
  const documentGeneration = tab.documentGeneration
  const loaded = await loadAddress(browser, tab, normalized, false)
  // A person sees the tab still loading, as in Chrome; an agent would otherwise read the page it left. A website that
  // asks the person to sign in first holds the page until they do, so the agent is told that instead.
  if (loaded === 'not-shown' && !options.byPerson) {
    throw pageLoadTimedOut(webContents)
  }
  if (loaded === 'renderer-exited' && !options.byPerson) throw new RendererExitedError(true)
  if (loaded !== 'asked-to-stay') return browserState(browser)
  if (!options.byPerson) throw new Error(PAGE_ASKED_TO_STAY)
  // The question is only the person's while the same page is still open in the tab. The page keeps running while it is
  // open, unlike under Chrome's own question, so an address change within the page, as an editor's autosave makes,
  // still leaves it.
  const samePage = (): boolean => findTab(browser, tab.id) === tab && tab.webContents === webContents
    && !webContents.isDestroyed() && tab.documentGeneration === documentGeneration
  if (!samePage()) return browserState(browser)
  // The question is about this page, so its tab comes into view first, as when a link was dropped on a tab behind the
  // one shown.
  await showTab(browser, tab)
  if (!samePage()) return browserState(browser)
  if (!await confirmLeavePage(browser)) {
    // The person keeps editing the page, which takes the keyboard as the page they asked for would have once loaded.
    if (samePage()) browser.focusPageAfterQuestion(tab.webContents)
    return browserState(browser)
  }
  if (!samePage()) return browserState(browser)
  // The workspace's sites may have changed while the question was open.
  if (tab.mcpGroupId) assertWorkspaceNavigationAllowed(browser, tab.mcpGroupId, normalized, 'direct')
  await loadAddress(browser, tab, normalized, true)
  return browserState(browser)
}

const PAGE_ASKED_TO_STAY = 'The page asked to confirm before it is left (a beforeunload prompt, as a page with unsaved changes shows), so it stayed open and nothing was loaded. To open the address anyway, use browser_new_tab. Otherwise finish or save what the page holds first. browser_close_tab closes the tab and discards its unsaved changes.'

/**
 * Loads the address in the tab and settles once the load ends, a policy denial
 * ends it, it fails or PAGE_LOAD_WAIT_MS pass while the page still loads. It
 * returns 'asked-to-stay' when the page asked before it is left
 * and so kept itself open; with `leave`, that question is skipped, once, as the
 * person already answered it. It returns 'not-shown' when the wait passed before
 * the new page replaced the one the tab showed, and 'renderer-exited' when the
 * load failed because the page's renderer exited while it loaded.
 */
async function loadAddress(browser: Browser, tab: BrowserTab, normalized: string,
  leave: boolean): Promise<'done' | 'asked-to-stay' | 'not-shown' | 'renderer-exited'> {
  const navigationPolicyDenialSequence = tab.navigationPolicyDenialSequence
  browser.prepareDiagnosticNavigation(tab)
  type NavigationOutcome =
    | { kind: 'loaded' }
    | { kind: 'loading' }
    | { kind: 'failed'; error: unknown }
    | { kind: 'policy-denied' }
  let resolvePolicyDenial!: (outcome: NavigationOutcome) => void
  const policyDenial = new Promise<NavigationOutcome>((resolve) => {
    resolvePolicyDenial = resolve
  })
  const detectPolicyDenial = (): void => {
    if (tab.navigationPolicyDenialSequence !== navigationPolicyDenialSequence) {
      resolvePolicyDenial({ kind: 'policy-denied' })
    }
  }
  // Without a listener Electron keeps the page and cancels the load, as an abort that is otherwise silent. The page's
  // question comes before the new page starts loading, so the listener goes once it starts and cannot answer a
  // question the new page asks later.
  let askedToStay = false
  const webContents = tab.webContents
  const onPreventUnload = (event: Electron.Event): void => {
    stopWatchingUnload()
    if (leave) event.preventDefault()
    else askedToStay = true
  }
  const onNavigationStart = (_event: Electron.Event, _url: string, isSameDocument: boolean, isMainFrame: boolean): void => {
    if (isMainFrame && !isSameDocument) stopWatchingUnload()
  }
  let shown = false
  const onShown = (): void => { shown = true }
  const stopWatchingUnload = (): void => {
    webContents.removeListener('will-prevent-unload', onPreventUnload)
    webContents.removeListener('did-start-navigation', onNavigationStart)
  }
  const rendererExit = watchRendererExit(webContents)
  try {
    let loadWait: ReturnType<typeof setTimeout> | undefined
    let outcome: NavigationOutcome
    try {
      webContents.on('will-frame-navigate', detectPolicyDenial)
      webContents.on('will-redirect', detectPolicyDenial)
      webContents.on('will-prevent-unload', onPreventUnload)
      webContents.on('did-start-navigation', onNavigationStart)
      webContents.on('did-navigate', onShown)
      const load = webContents.loadURL(normalized).then<NavigationOutcome, NavigationOutcome>(
        () => ({ kind: 'loaded' }),
        (error: unknown) => ({ kind: 'failed', error })
      )
      // A page whose load never ends, such as one with an image its server never answers, keeps loading in the tab, as
      // in Chrome, while the navigation returns.
      const stillLoading = new Promise<NavigationOutcome>((resolve) => {
        loadWait = setTimeout(() => resolve({ kind: 'loading' }), PAGE_LOAD_WAIT_MS)
      })
      // Electron can leave loadURL pending after preventDefault() rejects a
      // redirect. A policy decision is already terminal for this navigation,
      // so do not strand renderer IPC waiting for a load event that may never
      // arrive under compositor pressure.
      outcome = await Promise.race([load, policyDenial, stillLoading])
    } finally {
      clearTimeout(loadWait)
      webContents.removeListener('will-frame-navigate', detectPolicyDenial)
      webContents.removeListener('will-redirect', detectPolicyDenial)
      webContents.removeListener('did-navigate', onShown)
      stopWatchingUnload()
    }
    if (outcome.kind === 'loading') return shown ? 'done' : 'not-shown'
    if (outcome.kind !== 'failed' || findTab(browser, tab.id) !== tab
      || tab.navigationPolicyDenialSequence !== navigationPolicyDenialSequence) return 'done'
    if (askedToStay) return 'asked-to-stay'
    // Electron fails a load whose renderer exits with a bare ERR_FAILED, as if the network had, and can do so a task
    // before it reports the exit, so a failure waits a moment for that report.
    const navigationGeneration = tab.navigationGeneration
    const rendererExited = await rendererExit.reported(RENDERER_EXIT_REPORT_WAIT_MS)
    // A newer load in the tab, or its closing, replaced this one meanwhile, and only the newer one is reported.
    if (findTab(browser, tab.id) !== tab || tab.webContents !== webContents || webContents.isDestroyed()
      || tab.navigationGeneration !== navigationGeneration
      || tab.navigationPolicyDenialSequence !== navigationPolicyDenialSequence) return 'done'
    if (rendererExited) return 'renderer-exited'
    if (!isAbortedLoad(outcome.error)) throw localizedLoadFailure(outcome.error)
    return 'done'
  } finally {
    rendererExit.stop()
  }
}

/** Goes back in the tab's history, unless the workspace's navigation policy denies the entry. */
export async function back(browser: Browser, tabId?: string): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  // A sleeping tab wakes first, so Back goes from the page it wakes to, not from its sleeping page.
  if (tab.sleeping || tab.wakePromise) await browser.wakeTab(tab.id)
  if (tab.webContents.navigationHistory.canGoBack()) {
    const history = tab.webContents.navigationHistory
    const target = history.getAllEntries()[history.getActiveIndex() - 1]
    if (tab.mcpGroupId
      && target
      && !workspaceNavigationAllowed(browser, tab.mcpGroupId, target.url, 'history')) return browserState(browser)
    browser.prepareDiagnosticNavigation(tab)
    await history.goBack()
  }
  return browserState(browser)
}

/** Goes forward in the tab's history, unless the workspace's navigation policy denies the entry. */
export async function forward(browser: Browser, tabId?: string): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  // A sleeping tab wakes first, so Forward goes from the page it wakes to, not from its sleeping page.
  if (tab.sleeping || tab.wakePromise) await browser.wakeTab(tab.id)
  if (tab.webContents.navigationHistory.canGoForward()) {
    const history = tab.webContents.navigationHistory
    const target = history.getAllEntries()[history.getActiveIndex() + 1]
    if (tab.mcpGroupId
      && target
      && !workspaceNavigationAllowed(browser, tab.mcpGroupId, target.url, 'history')) return browserState(browser)
    browser.prepareDiagnosticNavigation(tab)
    await history.goForward()
  }
  return browserState(browser)
}

/**
 * Goes to a page of the tab's history that the person picked from the list Back or Forward shows, unless the
 * workspace's navigation policy denies it. A list that is out of date by then, because the tab moved in its history or
 * the history changed, goes nowhere rather than to whichever page now sits at that place.
 */
export function goToHistoryEntry(browser: Browser, tabId: string,
  entry: { index: number; url: string; activeIndex: number }): BrowserState {
  const tab = findTab(browser, tabId)
  if (!tab || tab.sleeping || tab.wakePromise || tab.webContents.isDestroyed()) return browserState(browser)
  const history = tab.webContents.navigationHistory
  if (history.getActiveIndex() !== entry.activeIndex || history.getAllEntries()[entry.index]?.url !== entry.url) {
    return browserState(browser)
  }
  if (tab.mcpGroupId && !workspaceNavigationAllowed(browser, tab.mcpGroupId, entry.url, 'history')) return browserState(browser)
  browser.prepareDiagnosticNavigation(tab)
  history.goToIndex(entry.index)
  return browserState(browser)
}

/** Reloads the tab's page, waking a sleeping tab first. */
export async function reload(browser: Browser, tabId?: string): Promise<BrowserState> {
  return reloadPage(browser, tabId, false)
}

/** Reloads the tab's page and its resources from the network. */
export async function reloadIgnoringCache(browser: Browser, tabId?: string): Promise<BrowserState> {
  return reloadPage(browser, tabId, true)
}

/**
 * Reloads the tab's page: retries a failed load or a gone renderer at its
 * address, replaces an unresponsive renderer, or reloads the page, then waits
 * for it to load.
 */
async function reloadPage(browser: Browser, tabId: string | undefined, ignoreCache: boolean): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  if (browser.rendererRecovery.isRecovering(tab.webContents)) throw new LocalizedError('appErrors.navigation.recoveryRunning')
  browser.prepareDiagnosticNavigation(tab)
  // Waking can show the page from the cache, as Back does, so the woken page is reloaded too.
  if (tab.sleeping || tab.wakePromise) await browser.wakeTab(tab.id)
  const pageProblem = tab.pageProblem
  tab.pageProblem = undefined
  publishChange(browser, false)
  if (pageProblem?.kind === 'load-error' || pageProblem?.kind === 'renderer-gone') {
    // A page whose load never ends is left loading, and the caller is told.
    const loaded = await settledWithin(tab.webContents.loadURL(pageProblem.url, ignoreCache
      ? { extraHeaders: 'Cache-Control: no-cache\r\nPragma: no-cache\r\n' }
      : undefined).catch(() => undefined))
    if (!loaded) throw pageLoadTimedOut(tab.webContents)
  } else if (pageProblem?.kind === 'unresponsive') {
    const contents = tab.webContents
    const navigationGeneration = tab.navigationGeneration
    const isCurrent = (): boolean => findTab(browser, tab.id) === tab
      && tab.webContents === contents && !contents.isDestroyed()
      && tab.navigationGeneration === navigationGeneration
    try {
      await browser.rendererRecovery.recover(contents, async () => {
        if (!isCurrent()) throw new LocalizedError('appErrors.navigation.recoveryPageChanged')
        // Reloading before the old process exits can stop at its crash rather
        // than load a replacement. Await that one intentional exit first.
        if (ignoreCache) contents.reloadIgnoringCache()
        else contents.reload()
        await browser.waitForPage(tab.id, 30_000)
      })
    } catch (error) {
      if (isCurrent() && !tab.pageProblem) {
        tab.pageProblem = pageProblem
        publishChange(browser, false)
      }
      throw error
    }
  } else {
    if (ignoreCache) tab.webContents.reloadIgnoringCache()
    else tab.webContents.reload()
  }
  await browser.waitForPage(tab.id, 30_000)
  return browserState(browser)
}

/** Stops the tab's current load. */
export function stop(browser: Browser, tabId?: string): BrowserState {
  getTab(browser, tabId).webContents.stop()
  return browserState(browser)
}

/**
 * Escape that the page with the keyboard left alone: as in Chrome, it stops that page while it loads. A page that has
 * loaded keeps its own requests going, and Home, which Hronaut loads again by itself, is left alone.
 */
export function stopFocusedPageLoading(browser: Browser): void {
  const webContents = focusedTab(browser)?.webContents
  if (!webContents || webContents.isDestroyed() || !webContents.isLoading() || isHronautHomeUrl(webContents.getURL())) return
  webContents.stop()
}

/** The tab whose page has the keyboard, if a tab's page has it. */
function focusedTab(browser: Browser): BrowserTab | undefined {
  const focused = electronWebContents.getFocusedWebContents()
  const tabId = focused ? browser.webContentsToTab.get(focused.id) : undefined
  return tabId ? findTab(browser, tabId) : undefined
}

/** Brings the tab into view, as the person's click on it does, unless it is the tab shown. */
async function showTab(browser: Browser, tab: BrowserTab): Promise<void> {
  if (browser.activeTabId !== tab.id) await browser.selectTabForPerson(tab.id)
}

/** Asks the person whether to leave a page that asked to confirm before it is left; true leaves it, and a question that could not be asked keeps the page. */
async function confirmLeavePage(browser: Browser): Promise<boolean> {
  try {
    return await (browser.options.confirmBeforeUnloadLeave?.() ?? Promise.resolve(false))
  } catch (error) {
    console.error('[browser] Could not ask before leaving a page with unsaved changes:', error)
    browser.options.onActionFailed?.('confirm leaving a page', error)
    return false
  }
}
