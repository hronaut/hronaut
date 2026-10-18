import type { BrowserWindow, View, WebContents } from 'electron'
import type { MessageKey, MessageParameters } from '../../../shared/i18n.js'
import type { BrowserSplitViewState } from '../../../shared/split-view.js'
import type { BrowserPageProblem, BrowserState } from '../../../shared/types.js'

/**
 * The tab fields a destroyed page reads and writes: the tab, its address,
 * view, page and favicon load, whether it loads, when it was last active and
 * the problem it shows.
 */
export interface PageDestroyedEventsTab {
  id: string
  url: string
  loading: boolean
  lastActiveAt: number
  view: View
  webContents: WebContents
  faviconAbortController?: AbortController
  pageProblem?: BrowserPageProblem
}

/** The tab manager options a destroyed page uses to cancel wallet requests and report a failed recovery. */
export interface PageDestroyedEventsOptions {
  onWalletTabClosed?: (tabId: string) => void | Promise<void>
  onActionFailed?: (action: string, error: unknown) => void
}

/**
 * What handling a tab's page being destroyed needs from the tab manager,
 * which keeps tab overview previews, network waits, native selection
 * sessions, expected closures, dialog monitoring, execution contexts, its
 * destroyed flag, the tabs, wallet requests, its options, localized text, the
 * split view, the window, the active tab, workspace activation, layout,
 * focus, tab order, selection, page geometry, tab creation and state
 * publication private. The split view and active tab stay manager fields
 * because layout, selection and closing read and write them too; they are
 * written back through the write members and read again at every use.
 */
export interface PageDestroyedEventsAccess<Tab extends PageDestroyedEventsTab> {
  /** Drops the tab's overview preview, which no longer shows the page. */
  invalidateTabOverviewPreview(tab: Tab): void
  /** The queue of overview preview captures. */
  tabOverviewPreviewCaptures(): { cancelPending(tabId: string): void }
  /** The ids of tabs whose page can be shown in the tab overview. */
  tabOverviewPreviewableTabs(): Set<string>
  /** The waits for network activity. */
  networkWaitController(): { reject(tabId: string, message: string): void }
  /** Cancels the tab's screenshot area selection and element picker. */
  cancelNativeSelectionSessions(tab: Tab): void
  /** The pages the manager is closing on purpose. */
  expectedTabClosures(): WeakSet<WebContents>
  /** The pending monitor attachment of each page, by WebContents id. */
  dialogMonitorAttachPromises(): Map<number, Promise<void>>
  /** The main world execution context of each frame of each page, by WebContents id. */
  defaultExecutionContexts(): Map<number, Map<string, { id: number; uniqueId?: string }>>
  /** Whether the browser is closing. */
  isDestroyed(): boolean
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** Runs a wallet lifecycle callback in the background, reporting its failure. */
  runWalletLifecycleAction(action: string, callback: () => unknown): void
  /** The tab manager's options. */
  options(): PageDestroyedEventsOptions
  /** Localized text for the person. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** Whether the tab is one of the split view's panes. */
  splitViewContains(tabId: string): boolean
  /** The split view, when one is open. */
  splitView(): BrowserSplitViewState | null
  /** Records the split view. */
  writeSplitView(splitView: BrowserSplitViewState | null): void
  /** The browser window. */
  window(): BrowserWindow
  /** The active tab's id. */
  activeTabId(): string | null
  /** Records the active tab's id. */
  writeActiveTabId(tabId: string | null): void
  /** Records the tab as its workspace's active tab. */
  markTabActiveInGroup(tab: Tab): void
  /** Lays out the visible tabs. */
  layout(): void
  /** Focuses the tab's page, or trusted chrome while it covers the pages. */
  focusTabOrTrustedChrome(tab: Tab): void
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** The open tabs in their order. */
  orderedTabs(): Tab[]
  /** Makes the tab the active tab. */
  selectTab(tabId: string): BrowserState
  /** Publishes the visible page's geometry. */
  publishPageGeometry(): void
  /** Opens a new tab. */
  createTab(options: { url: string; active: boolean }): Promise<Tab>
}
