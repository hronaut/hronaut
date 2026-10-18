import type { WebContents } from 'electron'
import type { BrowserNetworkRouteSummary } from '../../../shared/types.js'

/** A retained request-condition rule, with the response it fulfills requests with. */
export interface BrowserNetworkRouteRecord extends BrowserNetworkRouteSummary {
  responseHeaders?: Record<string, string>
  responseBody?: string
}

/**
 * The tab fields request conditions read and write. The rules, their native
 * application state and the epochs belong to the tab, so the tab manager's
 * native application, paused-request handling, emulation and renderer
 * handling stay authoritative for them.
 */
export interface NetworkConditionsTab {
  id: string
  url: string
  webContents: WebContents
  networkRoutes: BrowserNetworkRouteRecord[]
  networkConditionApplication: 'confirmed' | 'pending' | 'unknown'
  networkConditionEpoch: number
  networkDebuggerEpoch: number
}

/**
 * What request conditions need from the tab manager, which keeps the tabs
 * and the native application of rules to a page private. Applying rules stays
 * in the manager because paused-request handling also refreshes them.
 */
export interface NetworkConditionsAccess<Tab extends NetworkConditionsTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  isDestroyed(): boolean
  applyNetworkRoutes(tab: Tab, validate?: () => void, recovery?: boolean, mutate?: () => void, markSubmitted?: () => void, admission?: () => void): Promise<void>
}
