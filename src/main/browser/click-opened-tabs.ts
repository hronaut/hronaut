import type { Browser } from './browser.js'
import type { BrowserTab } from './browser-tab.js'

export const MAX_REPORTED_OPENED_TABS = 5

/** Tabs the clicked tab asked Hronaut to open while one click ran. A page timer
 * firing during the click is reported too: this is observation, not causality. */
export interface TabsOpenedDuringClick {
  /** Tabs still open in the clicked tab's workspace when the result is published. */
  tabIds: string[]
  /** Further open tabs beyond the listed bound. */
  more?: number
  /** Opened, then closed before the result was published. */
  closed?: number
  /** Requests Hronaut refused before opening, such as under a workspace navigation policy. */
  blocked?: number
  /** Requests Hronaut could not open, for example at the tab limit. */
  failed?: number
  /** Requests whose tab creation had not settled when the click returned. */
  pending?: number
}

export interface OpenedTabCreation {
  created(tabId: string): void
  failed(): void
}

const SETTLED: OpenedTabCreation = { created: () => undefined, failed: () => undefined }

export class OpenedTabObservation {
  private readonly openedTabIds: string[] = []
  private blocked = 0
  private failed = 0
  private pending = 0
  private stopped = false

  blockedRequest(): void {
    if (!this.stopped) this.blocked += 1
  }

  failedRequest(): void {
    if (!this.stopped) this.failed += 1
  }

  creationStarted(): OpenedTabCreation {
    if (this.stopped) return SETTLED
    this.pending += 1
    let settled = false
    const settle = (): boolean => {
      if (settled || this.stopped) return false
      settled = true
      this.pending -= 1
      return true
    }
    return {
      created: (tabId) => { if (settle()) this.openedTabIds.push(tabId) },
      failed: () => { if (settle()) this.failed += 1 }
    }
  }

  /** Stops recording. Only tabs `isCurrent` still accepts are listed; an empty
   * result means no request was observed, not that no later popup will open. */
  stop(isCurrent: (tabId: string) => boolean): TabsOpenedDuringClick | undefined {
    this.stopped = true
    if (!this.openedTabIds.length && !this.blocked && !this.failed && !this.pending) return undefined
    const current = this.openedTabIds.filter(isCurrent)
    const more = current.length - MAX_REPORTED_OPENED_TABS
    const closed = this.openedTabIds.length - current.length
    return {
      tabIds: current.slice(0, MAX_REPORTED_OPENED_TABS),
      ...(more > 0 ? { more } : {}),
      ...(closed ? { closed } : {}),
      ...(this.blocked ? { blocked: this.blocked } : {}),
      ...(this.failed ? { failed: this.failed } : {}),
      ...(this.pending ? { pending: this.pending } : {})
    }
  }
}

/** Rechecks listed tabs just before publication, after any later verification wait. */
export function recheckOpenedTabs(report: TabsOpenedDuringClick, isCurrent: (tabId: string) => boolean): TabsOpenedDuringClick {
  const tabIds = report.tabIds.filter(isCurrent)
  const closed = (report.closed ?? 0) + report.tabIds.length - tabIds.length
  return { ...report, tabIds, ...(closed ? { closed } : {}) }
}

/** Starts watching the tabs the tab's page asks Hronaut to open, as during a click. */
export function observeOpenedTabs(browser: Browser, tab: BrowserTab): OpenedTabObservation {
  const observation = new OpenedTabObservation()
  const observations = browser.openedTabObservations.get(tab) ?? new Set()
  observations.add(observation)
  browser.openedTabObservations.set(tab, observations)
  return observation
}

/** Publishes only tabs that are still open in the source tab's current workspace. */
export function stopObservingOpenedTabs(browser: Browser, tab: BrowserTab, observation: OpenedTabObservation): TabsOpenedDuringClick | undefined {
  const observations = browser.openedTabObservations.get(tab)
  observations?.delete(observation)
  if (observations?.size === 0) browser.openedTabObservations.delete(tab)
  const sourceCurrent = browser.tabs.get(tab.id) === tab
  const report = observation.stop((tabId) => {
    const opened = browser.tabs.get(tabId)
    return sourceCurrent && opened !== undefined && opened.mcpGroupId === tab.mcpGroupId
  })
  return sourceCurrent ? report : undefined
}
