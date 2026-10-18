import type { WebContents } from 'electron'
import type { BrowserState } from '../../../shared/types.js'

/**
 * The tab fields opening and closing Developer Tools read and write: its
 * address, which keeps Home out, the page, its title, its debugger epoch,
 * whether its request conditions are confirmed, and its request routes,
 * which the handoff clears first.
 */
export interface DevToolsTab {
  id: string
  title: string
  url: string
  webContents: WebContents
  networkDebuggerEpoch: number
  networkConditionApplication: 'confirmed' | 'pending' | 'unknown'
  /** Only counted and cleared. */
  networkRoutes: unknown[]
}

/**
 * What opening and closing Developer Tools needs from the tab manager, which
 * keeps the tabs, waking tabs, the person's input lock, request conditions
 * and routes, the set of pages opening Developer Tools, dialog monitoring and
 * the debugger queue private. The opening set stays a manager field because
 * debugger users, sleeping, frame observation and page input read it too.
 */
export interface DevToolsAccess<Tab extends DevToolsTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  isDestroyed(): boolean
  wakeTab(tabId: string): Promise<BrowserState>
  isHumanInteractionLocked(tab: Tab): boolean
  requireNetworkConditionsKnown(tab: Tab): void
  applyNetworkRoutes(tab: Tab, validate: () => void, recovery: boolean, mutate: () => void): Promise<void>
  devToolsOpening(): Set<number>
  dialogMonitorAttach(webContentsId: number): Promise<void> | undefined
  pendingDebuggerCommand(webContentsId: number): Promise<void> | undefined
}
