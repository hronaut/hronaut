import type { BrowserWindow, WebContents, WebContentsView } from 'electron'
import type { EmulationFrameGeometry } from '../../../shared/emulation-frame.js'
import type { PageCardGeometry } from '../../../shared/page-card.js'
import type { BrowserSplitViewState } from '../../../shared/split-view.js'
import type { BrowserJavaScriptDialog } from '../../../shared/types.js'

/**
 * The tab fields trusted chrome occlusion reads: its id, page and view,
 * whether it sleeps, its native input environment generation, an open
 * website dialog and the emulated viewport size its view has.
 */
export interface TrustedChromeOcclusionTab {
  id: string
  sleeping: boolean
  webContents: WebContents
  view: WebContentsView
  nativeInputEnvironmentGeneration: number
  dialog?: BrowserJavaScriptDialog
  emulationViewSize?: { width: number; height: number }
}

/**
 * What covering the pages with trusted chrome, the still image of them shown
 * meanwhile and suspending agent following need from the tab manager, which
 * keeps the tabs, the window, the active tab, the split view, trusted chrome
 * occlusion, the suspension of following, the tabs whose overview previews
 * may be retried, the page geometry kept while occluded, the MCP activity
 * follower, website dialogs, the occlusion snapshot, native frame capture,
 * layout and focus private. Occlusion and its suspension stay manager fields
 * because layout, input and following read them too; they are written back
 * through their setters and read again at every use.
 */
export interface TrustedChromeOcclusionAccess<Tab extends TrustedChromeOcclusionTab> {
  /** Whether the browser is closing. */
  isDestroyed(): boolean
  /** The browser window. */
  window(): BrowserWindow
  /** Every open tab. */
  tabs(): Iterable<Tab>
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** The active tab's id. */
  activeTabId(): string | null
  /** The split view, or null. */
  splitView(): BrowserSplitViewState | null
  /** Whether the tab is a pane of the split view. */
  splitViewContains(tabId: string): boolean
  /** Whether trusted chrome covers the page area. */
  browserContentOccluded(): boolean
  /** Records whether trusted chrome covers the page area. */
  writeBrowserContentOccluded(occluded: boolean): void
  /** Whether following agent activity is suspended, as while the address bar has focus or the agent card is open. */
  followAgentActivitySuspended(): boolean
  /** Records whether following agent activity is suspended. */
  writeFollowAgentActivitySuspended(suspended: boolean): void
  /** The tabs that were on screen as trusted chrome opened, whose overview previews may be retried hidden. */
  tabOverviewPreviewableTabs(): Set<string>
  /** The frames around emulated pages, as the shell shows them now. */
  getEmulationFrames(): EmulationFrameGeometry[]
  /** The cards under the pages, as the shell shows them now. */
  getPageCards(): PageCardGeometry[]
  /** Records the frames around emulated pages to keep showing while trusted chrome covers them. */
  writeOccludedEmulationFrames(frames: EmulationFrameGeometry[]): void
  /** Records the page cards to keep showing while trusted chrome covers the pages. */
  writeOccludedPageCards(cards: PageCardGeometry[]): void
  /** The follower of MCP activity, which holds still while the pages are covered or following is suspended. */
  mcpActivityFollower(): { setOccluded(occluded: boolean): void }
  /** Dismisses the tab's website dialog, which trusted chrome would hide. */
  dismissWebsiteDialogForTrustedChrome(tab: Tab): Promise<void>
  /** The still image of the pages shown under trusted chrome. */
  occlusionSnapshot(): { begin(): void; end(): void }
  /** The native frame captures, with the one in flight for a page. */
  nativePreviewCapture(): { settled(contents: object): Promise<void> | undefined }
  /** Places and shows the pages in view. */
  layout(): void
  /** Stops waiting to focus a page once trusted chrome closes, returning the page's tab. */
  cancelFocusAfterTrustedChrome(): Tab | undefined
  /** Focuses the tab's page, or the shell while trusted chrome is open. */
  focusTabOrTrustedChrome(tab: Tab): void
}
