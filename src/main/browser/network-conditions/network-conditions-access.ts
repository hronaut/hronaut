import type { WebContents } from 'electron'
import type { BrowserEmulationState, BrowserNetworkRouteSummary } from '../../../shared/types.js'

/** A retained request-condition rule, with the response it fulfills requests with. */
export interface BrowserNetworkRouteRecord extends BrowserNetworkRouteSummary {
  responseHeaders?: Record<string, string>
  responseBody?: string
}

/**
 * The tab fields request conditions read and write, and the emulated network
 * conditions their throttling joins. The rules, their native application
 * state and the epochs belong to the tab, so the tab manager's emulation,
 * DevTools and renderer handling can read and reset them too.
 */
export interface NetworkConditionsTab {
  id: string
  url: string
  webContents: WebContents
  networkRoutes: BrowserNetworkRouteRecord[]
  networkConditionApplication: 'confirmed' | 'pending' | 'unknown'
  networkConditionEpoch: number
  networkDebuggerEpoch: number
  emulation: Pick<BrowserEmulationState, 'network'>
}

/**
 * What request conditions need from the tab manager, which keeps the tabs,
 * its destroyed flag, the debugger queue, native network emulation, the
 * paused request queues, the rule refresh timers and state publication
 * private. The queues and timers stay manager fields because closing the
 * browser clears them; native network emulation stays a manager method
 * because emulation applies it too.
 */
export interface NetworkConditionsAccess<Tab extends NetworkConditionsTab> {
  /** The tab with this id, or the active tab; throws when there is none. */
  getTab(tabId?: string): Tab
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** Whether the browser is closing. */
  isDestroyed(): boolean
  /** Runs a debugger operation in the page's queue, checking admission before each step when given. */
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>, validateAdmission?: () => void): Promise<T>
  /** Applies the emulated network conditions natively, together with the rules' throttling. */
  applyNetworkEmulation(
    webContents: WebContents,
    preset: BrowserEmulationState['network'],
    routes: BrowserNetworkRouteRecord[],
    send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  ): Promise<void>
  /** The queue of paused requests of each page, by WebContents id. */
  networkRouteQueues(): Map<number, Promise<void>>
  /** The scheduled rule refresh of each page, by WebContents id. */
  networkRouteRefreshTimers(): Map<number, NodeJS.Timeout>
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
}
