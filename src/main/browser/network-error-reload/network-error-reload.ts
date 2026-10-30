import { net, type WebContents } from 'electron'
import type { BrowserPageProblem } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { publishChange } from '../browser-state/browser-state.js'
import { isWebUrl } from '../url.js'
import { workspaceNavigationAllowed } from '../workspace-navigation/workspace-navigation.js'

/**
 * As in Chrome, how long a page that could not reach its website waits before it loads again by itself: 1 s after it
 * failed, and longer each time that load fails too, up to every 30 min.
 */
const RELOAD_DELAYS_MS = [1_000, 5_000, 30_000, 60_000, 300_000, 600_000, 1_800_000] as const
/** How often a reload that is due checks again whether the computer is online and the tab in view. */
const RECHECK_MS = 1_000
/**
 * Chromium's errors for a page load that could not reach the website or lost its connection, such as while the
 * computer is offline or rejoins a network. Electron reports a page that failed after it was shown with no error name,
 * so a page the person may be using is never loaded again.
 */
const NETWORK_ERRORS: ReadonlySet<string> = new Set([
  'ERR_ADDRESS_UNREACHABLE', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_FAILED', 'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET', 'ERR_CONNECTION_TIMED_OUT', 'ERR_EMPTY_RESPONSE', 'ERR_INTERNET_DISCONNECTED',
  'ERR_NAME_NOT_RESOLVED', 'ERR_NAME_RESOLUTION_FAILED', 'ERR_NETWORK_CHANGED', 'ERR_NETWORK_IO_SUSPENDED',
  'ERR_PROXY_CONNECTION_FAILED', 'ERR_QUIC_PROTOCOL_ERROR', 'ERR_SOCKET_NOT_CONNECTED', 'ERR_TIMED_OUT',
  'ERR_TUNNEL_CONNECTION_FAILED'
])

/** A tab's reload of the page it could not load, waiting for its time or, once it ran, the load it started. */
interface PendingReload {
  readonly problem: BrowserPageProblem
  readonly webContents: WebContents
  /** How many reloads before this one failed in turn. */
  readonly attempts: number
  timer?: ReturnType<typeof setTimeout>
  /** The tab's navigation generation when the reload loaded the page again. */
  startedAtNavigation?: number
}

const reloads = new WeakMap<BrowserTab, PendingReload>()
const watchedPages = new WeakSet<WebContents>()
/** The address and method of each tab's last page request that failed. */
const failedPageRequests = new WeakMap<BrowserTab, { readonly url: string; readonly method: string }>()

/**
 * Notes the tab's page request that failed, which the session reports before the page's failure. As in Chrome, a page
 * a form sent that failed, such as one sent while offline, is not loaded again by itself: that would load its address
 * without what the form sent, or send it again unasked.
 */
export function notePageRequestFailed(tab: BrowserTab, url: string, method: string): void {
  failedPageRequests.set(tab, { url, method })
}

/**
 * Follows a tab whose page just failed to load. As in Chrome, a website page that could not reach its website loads
 * again by itself once the computer is online and the tab is in view, so tabs restored while the network was down show
 * their pages once it is back; each failure of that reload waits longer for the next. A refused certificate or another
 * failure stays, and so does a tab whose network is emulated offline or routed. A reload waits while an agent command
 * runs in the tab, and is not made to a website the tab's workspace may not open.
 */
export function reloadWhenWebsiteReachable(browser: Browser, tab: BrowserTab): void {
  const previous = reloads.get(tab)
  if (previous?.timer) clearTimeout(previous.timer)
  reloads.delete(tab)
  const problem = tab.pageProblem
  if (problem?.kind !== 'load-error' || problem.certificate || !NETWORK_ERRORS.has(problem.errorDescription ?? '')) return
  if (!isWebUrl(problem.url) || !reloadable(tab)) return
  // Only the reload's own failure waits longer: no other navigation started in the tab since it loaded the page again.
  const reloadFailed = previous?.startedAtNavigation !== undefined && tab.navigationGeneration - previous.startedAtNavigation <= 1
  const attempts = reloadFailed ? previous.attempts + 1 : 0
  const pending: PendingReload = { problem, webContents: tab.webContents, attempts }
  reloads.set(tab, pending)
  forgetWhenPageCloses(tab)
  wait(browser, tab, pending, RELOAD_DELAYS_MS[Math.min(attempts, RELOAD_DELAYS_MS.length - 1)]!)
}

/** Whether the tab uses its real network, which an agent may have emulated offline or routed. */
function reloadable(tab: BrowserTab): boolean {
  return tab.emulation.network !== 'offline' && tab.networkRoutes.length === 0
}

/** Whether the tab's page that failed at `url` was sent by a form, as a POST, rather than asked for. */
function sentByForm(tab: BrowserTab, url: string): boolean {
  const request = failedPageRequests.get(tab)
  return request?.url === url && request.method !== 'GET'
}

/** Ends the tab's reload once its page closes, as when the tab closes or its page is replaced. */
function forgetWhenPageCloses(tab: BrowserTab): void {
  const contents = tab.webContents
  if (watchedPages.has(contents)) return
  watchedPages.add(contents)
  contents.once('destroyed', () => {
    const pending = reloads.get(tab)
    if (pending?.webContents !== contents) return
    clearTimeout(pending.timer)
    reloads.delete(tab)
  })
}

/**
 * Waits `delayMs`, then loads the page again if the tab still shows its failure, the computer is online and the tab
 * in view, and no agent command or recovery runs in it; otherwise it checks again a second later, which does not count
 * as an attempt.
 */
function wait(browser: Browser, tab: BrowserTab, pending: PendingReload, delayMs: number): void {
  pending.timer = setTimeout(() => {
    pending.timer = undefined
    if (reloads.get(tab) !== pending) return
    const stillFailed = !browser.destroyed && findTab(browser, tab.id) === tab && tab.webContents === pending.webContents
      && !pending.webContents.isDestroyed() && tab.pageProblem === pending.problem && !tab.sleeping && reloadable(tab)
      && !sentByForm(tab, pending.problem.url)
    if (!stillFailed) {
      reloads.delete(tab)
      return
    }
    const busy = tab.wakePromise || browser.mcpActivitiesByTab.has(tab.id) || browser.rendererRecovery.isRecovering(tab.webContents)
    if (busy || !inView(browser, tab) || !net.isOnline()) {
      wait(browser, tab, pending, RECHECK_MS)
      return
    }
    if (tab.mcpGroupId && !workspaceNavigationAllowed(browser, tab.mcpGroupId, pending.problem.url, 'history')) {
      reloads.delete(tab)
      return
    }
    // As the person's Reload does for a page that failed to load.
    pending.startedAtNavigation = tab.navigationGeneration
    browser.prepareDiagnosticNavigation(tab)
    tab.pageProblem = undefined
    publishChange(browser, false)
    pending.webContents.loadURL(pending.problem.url).catch(() => undefined)
  }, delayMs)
}

/** Whether the window shows the tab: the active tab or a pane of the split view, in a window that is open on screen. */
function inView(browser: Browser, tab: BrowserTab): boolean {
  return (tab.id === browser.activeTabId || browser.splitViewContains(tab.id))
    && !browser.window.isDestroyed() && browser.window.isVisible() && !browser.window.isMinimized()
}
