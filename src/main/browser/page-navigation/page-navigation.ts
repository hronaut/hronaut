import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { localizedLoadFailure } from '../load-failure-error.js'
import { PAGE_LOAD_WAIT_MS, settledWithin } from '../page-waits/page-load-limit.js'
import { RendererExitedError } from '../renderer-exit-guard.js'
import { keepSessionCookies } from '../session-cookies/saved-session-cookies.js'
import { isHronautHomeUrl, normalizeAddress } from '../url.js'
import type { PageNavigationAccess, PageNavigationTab } from './page-navigation-access.js'

// A copy of the tab manager's own check, which its load and wake handling keep using.
const ABORTED_LOAD_ERROR = -3

function isAbortedLoad(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const details = error as Error & { code?: unknown; errno?: unknown }
  return details.code === ABORTED_LOAD_ERROR
    || details.errno === ABORTED_LOAD_ERROR
    || details.code === 'ERR_ABORTED'
    || /\bERR_ABORTED\b|\(-3\)\s+loading\b/.test(error.message)
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
export async function navigate<Tab extends PageNavigationTab>(access: PageNavigationAccess<Tab>, url: string, tabId?: string,
  options: { byPerson?: boolean } = {}): Promise<BrowserState> {
  const tab = access.getTab(tabId)
  const normalized = normalizeAddress(url, access.searchEngine())
  if (tab.mcpGroupId && isHronautHomeUrl(normalized)) {
    throw new LocalizedError('appErrors.navigation.homeInAgentWorkspace')
  }
  if (tab.mcpGroupId) {
    access.assertWorkspaceNavigationAllowed(tab.mcpGroupId, normalized, 'direct')
    // A tab sent to another address starts a new task, so its workspace forgets which page opened which tab, as Chrome
    // does for a typed address.
    access.forgetTabsOpenedFrom(tab.mcpGroupId)
  }
  // A workspace's sites get the session cookies it saved at the last quit, as its first page does, which this load
  // then replaces.
  if (!isHronautHomeUrl(normalized)) await keepSessionCookies(tab.webContents.session)
  const webContents = tab.webContents
  const documentGeneration = tab.documentGeneration
  const loaded = await loadAddress(access, tab, normalized, false)
  // A person sees the tab still loading, as in Chrome; an agent would otherwise read the page it left.
  if (loaded === 'not-shown' && !options.byPerson) throw new LocalizedError('appErrors.page.loadTimedOut')
  if (loaded === 'renderer-exited' && !options.byPerson) throw new RendererExitedError(true)
  if (loaded !== 'asked-to-stay') return access.getState()
  if (!options.byPerson) throw new Error(PAGE_ASKED_TO_STAY)
  // The question is only the person's while the same page is still open in the tab. The page keeps running while it is
  // open, unlike under Chrome's own question, so an address change within the page, as an editor's autosave makes,
  // still leaves it.
  const samePage = (): boolean => access.findTab(tab.id) === tab && tab.webContents === webContents
    && !webContents.isDestroyed() && tab.documentGeneration === documentGeneration
  if (!samePage()) return access.getState()
  if (!await access.confirmLeavePage()) {
    // The person keeps editing the page, which takes the keyboard as the page they asked for would have once loaded.
    if (samePage()) access.focusKeptPage(tab)
    return access.getState()
  }
  if (!samePage()) return access.getState()
  // The workspace's sites may have changed while the question was open.
  if (tab.mcpGroupId) access.assertWorkspaceNavigationAllowed(tab.mcpGroupId, normalized, 'direct')
  await loadAddress(access, tab, normalized, true)
  return access.getState()
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
async function loadAddress<Tab extends PageNavigationTab>(access: PageNavigationAccess<Tab>, tab: Tab, normalized: string,
  leave: boolean): Promise<'done' | 'asked-to-stay' | 'not-shown' | 'renderer-exited'> {
  const navigationPolicyDenialSequence = tab.navigationPolicyDenialSequence
  access.prepareDiagnosticNavigation(tab)
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
  // A crashed page's load starts a new renderer, so only an exit during the load is this load's.
  const crashedAtStart = webContents.isCrashed()
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
  webContents.on('will-frame-navigate', detectPolicyDenial)
  webContents.on('will-redirect', detectPolicyDenial)
  webContents.on('will-prevent-unload', onPreventUnload)
  webContents.on('did-start-navigation', onNavigationStart)
  webContents.on('did-navigate', onShown)
  const load = webContents.loadURL(normalized).then<NavigationOutcome, NavigationOutcome>(
    () => ({ kind: 'loaded' }),
    (error: unknown) => ({ kind: 'failed', error })
  )
  // A page whose load never ends, such as one with an image its server never answers, keeps loading in the tab, as in
  // Chrome, while the navigation returns.
  let loadWait: ReturnType<typeof setTimeout> | undefined
  const stillLoading = new Promise<NavigationOutcome>((resolve) => {
    loadWait = setTimeout(() => resolve({ kind: 'loading' }), PAGE_LOAD_WAIT_MS)
  })
  let outcome: NavigationOutcome
  try {
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
  if (outcome.kind !== 'failed' || access.findTab(tab.id) !== tab
    || tab.navigationPolicyDenialSequence !== navigationPolicyDenialSequence) return 'done'
  if (askedToStay) return 'asked-to-stay'
  // Electron fails a load whose renderer exits with a plain ERR_FAILED, as if the network had, before it marks the
  // renderer gone, so the check waits for the rest of that exit.
  await new Promise(resolve => setImmediate(resolve))
  if (access.findTab(tab.id) !== tab) return 'done'
  if (!crashedAtStart && !webContents.isDestroyed() && webContents.isCrashed()) return 'renderer-exited'
  if (!isAbortedLoad(outcome.error)) throw localizedLoadFailure(outcome.error)
  return 'done'
}

/** Goes back in the tab's history, unless the workspace's navigation policy denies the entry. */
export async function back<Tab extends PageNavigationTab>(access: PageNavigationAccess<Tab>, tabId?: string): Promise<BrowserState> {
  const tab = access.getTab(tabId)
  if (tab.webContents.navigationHistory.canGoBack()) {
    const history = tab.webContents.navigationHistory
    const target = history.getAllEntries()[history.getActiveIndex() - 1]
    if (tab.mcpGroupId
      && target
      && !access.workspaceNavigationAllowed(tab.mcpGroupId, target.url, 'history')) return access.getState()
    access.prepareDiagnosticNavigation(tab)
    await history.goBack()
  }
  return access.getState()
}

/** Goes forward in the tab's history, unless the workspace's navigation policy denies the entry. */
export async function forward<Tab extends PageNavigationTab>(access: PageNavigationAccess<Tab>, tabId?: string): Promise<BrowserState> {
  const tab = access.getTab(tabId)
  if (tab.webContents.navigationHistory.canGoForward()) {
    const history = tab.webContents.navigationHistory
    const target = history.getAllEntries()[history.getActiveIndex() + 1]
    if (tab.mcpGroupId
      && target
      && !access.workspaceNavigationAllowed(tab.mcpGroupId, target.url, 'history')) return access.getState()
    access.prepareDiagnosticNavigation(tab)
    await history.goForward()
  }
  return access.getState()
}

/**
 * Goes to a page of the tab's history that the person picked from the list Back or Forward shows, unless the
 * workspace's navigation policy denies it. A list that is out of date by then, because the tab moved in its history or
 * the history changed, goes nowhere rather than to whichever page now sits at that place.
 */
export function goToHistoryEntry<Tab extends PageNavigationTab>(access: PageNavigationAccess<Tab>, tabId: string,
  entry: { index: number; url: string; activeIndex: number }): BrowserState {
  const tab = access.findTab(tabId)
  if (!tab || tab.sleeping || tab.wakePromise || tab.webContents.isDestroyed()) return access.getState()
  const history = tab.webContents.navigationHistory
  if (history.getActiveIndex() !== entry.activeIndex || history.getAllEntries()[entry.index]?.url !== entry.url) {
    return access.getState()
  }
  if (tab.mcpGroupId && !access.workspaceNavigationAllowed(tab.mcpGroupId, entry.url, 'history')) return access.getState()
  access.prepareDiagnosticNavigation(tab)
  history.goToIndex(entry.index)
  return access.getState()
}

/** Reloads the tab's page, waking a sleeping tab first. */
export async function reload<Tab extends PageNavigationTab>(access: PageNavigationAccess<Tab>, tabId?: string): Promise<BrowserState> {
  return reloadPage(access, tabId, false)
}

/** Reloads the tab's page and its resources from the network. */
export async function reloadIgnoringCache<Tab extends PageNavigationTab>(access: PageNavigationAccess<Tab>, tabId?: string): Promise<BrowserState> {
  return reloadPage(access, tabId, true)
}

/**
 * Reloads the tab's page: retries a failed load or a gone renderer at its
 * address, replaces an unresponsive renderer, or reloads the page, then waits
 * for it to load.
 */
async function reloadPage<Tab extends PageNavigationTab>(access: PageNavigationAccess<Tab>, tabId: string | undefined, ignoreCache: boolean): Promise<BrowserState> {
  const tab = access.getTab(tabId)
  if (access.isRendererRecovering(tab.webContents)) throw new LocalizedError('appErrors.navigation.recoveryRunning')
  access.prepareDiagnosticNavigation(tab)
  // Waking can show the page from the cache, as Back does, so the woken page is reloaded too.
  if (tab.sleeping || tab.wakePromise) await access.wakeTab(tab.id)
  const pageProblem = tab.pageProblem
  tab.pageProblem = undefined
  access.changed(false)
  if (pageProblem?.kind === 'load-error' || pageProblem?.kind === 'renderer-gone') {
    // A page whose load never ends is left loading, and the caller is told.
    const loaded = await settledWithin(tab.webContents.loadURL(pageProblem.url, ignoreCache
      ? { extraHeaders: 'Cache-Control: no-cache\r\nPragma: no-cache\r\n' }
      : undefined).catch(() => undefined))
    if (!loaded) throw new LocalizedError('appErrors.page.loadTimedOut')
  } else if (pageProblem?.kind === 'unresponsive') {
    const contents = tab.webContents
    const navigationGeneration = tab.navigationGeneration
    const isCurrent = (): boolean => access.findTab(tab.id) === tab
      && tab.webContents === contents && !contents.isDestroyed()
      && tab.navigationGeneration === navigationGeneration
    try {
      await access.recoverRenderer(contents, async () => {
        if (!isCurrent()) throw new LocalizedError('appErrors.navigation.recoveryPageChanged')
        // Reloading before the old process exits can stop at its crash rather
        // than load a replacement. Await that one intentional exit first.
        if (ignoreCache) contents.reloadIgnoringCache()
        else contents.reload()
        await access.waitForPage(tab.id, 30_000)
      })
    } catch (error) {
      if (isCurrent() && !tab.pageProblem) {
        tab.pageProblem = pageProblem
        access.changed(false)
      }
      throw error
    }
  } else {
    if (ignoreCache) tab.webContents.reloadIgnoringCache()
    else tab.webContents.reload()
  }
  await access.waitForPage(tab.id, 30_000)
  return access.getState()
}

/** Stops the tab's current load. */
export function stop<Tab extends PageNavigationTab>(access: PageNavigationAccess<Tab>, tabId?: string): BrowserState {
  access.getTab(tabId).webContents.stop()
  return access.getState()
}

/**
 * Escape that the page with the keyboard left alone: as in Chrome, it stops that page while it loads. A page that has
 * loaded keeps its own requests going, and Home, which Hronaut loads again by itself, is left alone.
 */
export function stopFocusedPageLoading<Tab extends PageNavigationTab>(access: PageNavigationAccess<Tab>): void {
  const webContents = access.focusedTab()?.webContents
  if (!webContents || webContents.isDestroyed() || !webContents.isLoading() || isHronautHomeUrl(webContents.getURL())) return
  webContents.stop()
}
