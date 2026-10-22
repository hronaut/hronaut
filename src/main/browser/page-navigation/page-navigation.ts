import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { localizedLoadFailure } from '../load-failure-error.js'
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
 * load throws. A page that asks before it is left, as an editor with unsaved
 * changes does, keeps itself open: a person who started the load is asked, as
 * Chrome asks "Leave site?", and an agent gets an error saying so instead of a
 * load that silently did not happen.
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
  const webContents = tab.webContents
  const documentGeneration = tab.documentGeneration
  const askedToStay = await loadAddress(access, tab, normalized, false)
  if (!askedToStay) return access.getState()
  if (!options.byPerson) throw new Error(PAGE_ASKED_TO_STAY)
  // The question is only the person's while the same page is still open in the tab. The page keeps running while it is
  // open, unlike under Chrome's own question, so an address change within the page, as an editor's autosave makes,
  // still leaves it.
  const samePage = (): boolean => access.findTab(tab.id) === tab && tab.webContents === webContents
    && !webContents.isDestroyed() && tab.documentGeneration === documentGeneration
  if (!samePage() || !await access.confirmLeavePage() || !samePage()) return access.getState()
  // The workspace's sites may have changed while the question was open.
  if (tab.mcpGroupId) access.assertWorkspaceNavigationAllowed(tab.mcpGroupId, normalized, 'direct')
  await loadAddress(access, tab, normalized, true)
  return access.getState()
}

const PAGE_ASKED_TO_STAY = 'The page asked to confirm before it is left (a beforeunload prompt, as a page with unsaved changes shows), so it stayed open and nothing was loaded. To open the address anyway, use browser_new_tab. Otherwise finish or save what the page holds first. browser_close_tab closes the tab and discards its unsaved changes.'

/**
 * Loads the address in the tab and settles once the load ends, a policy denial
 * ends it or it fails. It returns true when the page asked before it is left
 * and so kept itself open; with `leave`, that question is skipped, once, as the
 * person already answered it.
 */
async function loadAddress<Tab extends PageNavigationTab>(access: PageNavigationAccess<Tab>, tab: Tab, normalized: string, leave: boolean): Promise<boolean> {
  const navigationPolicyDenialSequence = tab.navigationPolicyDenialSequence
  access.prepareDiagnosticNavigation(tab)
  type NavigationOutcome =
    | { kind: 'loaded' }
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
  const stopWatchingUnload = (): void => {
    webContents.removeListener('will-prevent-unload', onPreventUnload)
    webContents.removeListener('did-start-navigation', onNavigationStart)
  }
  webContents.on('will-frame-navigate', detectPolicyDenial)
  webContents.on('will-redirect', detectPolicyDenial)
  webContents.on('will-prevent-unload', onPreventUnload)
  webContents.on('did-start-navigation', onNavigationStart)
  const load = webContents.loadURL(normalized).then<NavigationOutcome, NavigationOutcome>(
    () => ({ kind: 'loaded' }),
    (error: unknown) => ({ kind: 'failed', error })
  )
  let outcome: NavigationOutcome
  try {
    // Electron can leave loadURL pending after preventDefault() rejects a
    // redirect. A policy decision is already terminal for this navigation,
    // so do not strand renderer IPC waiting for a load event that may never
    // arrive under compositor pressure.
    outcome = await Promise.race([load, policyDenial])
  } finally {
    webContents.removeListener('will-frame-navigate', detectPolicyDenial)
    webContents.removeListener('will-redirect', detectPolicyDenial)
    stopWatchingUnload()
  }
  if (outcome.kind !== 'failed' || access.findTab(tab.id) !== tab
    || tab.navigationPolicyDenialSequence !== navigationPolicyDenialSequence) return false
  if (askedToStay) return true
  if (!isAbortedLoad(outcome.error)) throw localizedLoadFailure(outcome.error)
  return false
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
    await tab.webContents.loadURL(pageProblem.url, ignoreCache
      ? { extraHeaders: 'Cache-Control: no-cache\r\nPragma: no-cache\r\n' }
      : undefined).catch(() => undefined)
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
