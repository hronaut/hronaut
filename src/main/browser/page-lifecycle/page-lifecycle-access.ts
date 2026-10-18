import type { WebContents } from 'electron'
import type { BrowserPageLifecycleResult, BrowserPageLifecycleState, BrowserState } from '../../../shared/types.js'

/**
 * The tab fields freezing and resuming a page read and write: its document,
 * its lifecycle state and pending lifecycle command, the animations a freeze
 * held, and the native input environment generation every lifecycle request
 * advances.
 */
export interface PageLifecycleTab {
  id: string
  url: string
  navigationGeneration: number
  nativeInputEnvironmentGeneration: number
  sleeping: boolean
  wakePromise?: Promise<void>
  webContents: WebContents
  pageLifecycleState: BrowserPageLifecycleState
  pageLifecycleUnknownRequest?: Exclude<BrowserPageLifecycleState, 'unknown'>
  pageLifecycleOperation?: {
    requestedState: Exclude<BrowserPageLifecycleState, 'unknown'>
    promise: Promise<BrowserPageLifecycleResult>
  }
  pageLifecycleAnimations?: Array<{ currentTime: number | null; playbackRate: number }>
}

/**
 * What freezing and resuming a page needs from the tab manager, which keeps
 * the tabs, the debugger queue, dialog monitoring, DevTools opening, page
 * presentation and state publication private. The debugger queue and dialog
 * monitoring stay manager fields because every debugger user shares them;
 * page presentation stays a manager method because layout uses it too.
 */
export interface PageLifecycleAccess<Tab extends PageLifecycleTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  isDestroyed(): boolean
  inDebuggerQueue<T>(webContentsId: number, operation: () => Promise<T>): Promise<T>
  dialogMonitorAttach(webContentsId: number): Promise<void> | undefined
  isDevToolsOpening(webContentsId: number): boolean
  reconcileTabPresentation(tab: Tab): void
  changed(persist?: boolean): void
  getState(): BrowserState
}
