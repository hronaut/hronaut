import { net, type WebContents } from 'electron'
import type { BrowserPageProblem } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { publishChange } from '../browser-state/browser-state.js'

/**
 * As in Chrome, how long a page that could not reach its website waits before it loads again by itself: 1 s after it
 * failed, and longer each time that load fails too, up to every 30 min.
 */
const RELOAD_DELAYS_MS = [1_000, 5_000, 30_000, 60_000, 300_000, 600_000, 1_800_000] as const
/** How often a reload that is due checks again whether the computer is online and the tab in view. */
const RECHECK_MS = 1_000
/** Chromium's errors for a page load that could not reach the website, such as while the computer is offline. */
const NETWORK_ERRORS: ReadonlySet<string> = new Set([
  'ERR_ADDRESS_UNREACHABLE', 'ERR_CONNECTION_FAILED', 'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_TIMED_OUT',
  'ERR_INTERNET_DISCONNECTED', 'ERR_NAME_NOT_RESOLVED', 'ERR_NAME_RESOLUTION_FAILED', 'ERR_NETWORK_CHANGED',
  'ERR_NETWORK_IO_SUSPENDED', 'ERR_PROXY_CONNECTION_FAILED', 'ERR_TIMED_OUT'
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

/**
 * Follows a tab whose page just failed to load. As in Chrome, a page whose website could not be reached loads again
 * by itself once the computer is online and the tab is in view, so tabs restored while the network was down show their
 * pages once it is back; each failure of that reload waits longer for the next. A refused certificate or another
 * failure stays. So does a tab of an agent's workspace, which its agent loads again, and a tab whose network is
 * emulated offline or routed.
 */
export function reloadWhenWebsiteReachable(browser: Browser, tab: BrowserTab): void {
  const previous = reloads.get(tab)
  if (previous?.timer) clearTimeout(previous.timer)
  reloads.delete(tab)
  const problem = tab.pageProblem
  if (problem?.kind !== 'load-error' || problem.certificate || !NETWORK_ERRORS.has(problem.errorDescription ?? '')) return
  if (!reloadable(tab)) return
  // Only the reload's own failure waits longer: no other navigation started in the tab since it loaded the page again.
  const reloadFailed = previous?.startedAtNavigation !== undefined && tab.navigationGeneration - previous.startedAtNavigation <= 1
  const attempts = reloadFailed ? previous.attempts + 1 : 0
  const pending: PendingReload = { problem, webContents: tab.webContents, attempts }
  reloads.set(tab, pending)
  forgetWhenPageCloses(tab)
  wait(browser, tab, pending, RELOAD_DELAYS_MS[Math.min(attempts, RELOAD_DELAYS_MS.length - 1)]!)
}

/** Whether the tab is one Hronaut loads again by itself: the person's own, with its real network. */
function reloadable(tab: BrowserTab): boolean {
  return !tab.mcpGroupId && tab.emulation.network !== 'offline' && tab.networkRoutes.length === 0
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
 * in view; otherwise it checks again a second later, which does not count as an attempt.
 */
function wait(browser: Browser, tab: BrowserTab, pending: PendingReload, delayMs: number): void {
  pending.timer = setTimeout(() => {
    pending.timer = undefined
    if (reloads.get(tab) !== pending) return
    const stillFailed = !browser.destroyed && findTab(browser, tab.id) === tab && tab.webContents === pending.webContents
      && !pending.webContents.isDestroyed() && tab.pageProblem === pending.problem && !tab.sleeping && reloadable(tab)
    if (!stillFailed) {
      reloads.delete(tab)
      return
    }
    if (tab.wakePromise || !inView(browser, tab) || !net.isOnline()) {
      wait(browser, tab, pending, RECHECK_MS)
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
