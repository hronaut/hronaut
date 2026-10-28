import type { NavigationEntry, WebContents } from 'electron'
import type {
  BrowserJavaScriptDialog,
  BrowserPageLifecycleResult,
  BrowserPageLifecycleState,
  BrowserState,
  BrowserTabOverviewPreview
} from '../../../shared/types.js'
import type { BrowserVideoState } from '../../../shared/video.js'
import type { BrowserDomRecordingState } from '../dom-recorder.js'
import type { BrowserLiveRegionRecordingState } from '../live-region-recorder.js'
import type { BrowserProfilingState } from '../profiling-controller.js'
import type { BrowserReproRecordingInternal } from '../repro-recorder.js'

/**
 * The tab fields putting a tab to sleep and waking it read and write: its
 * page and address, whether it sleeps or wakes, the history it sleeps with,
 * its loading and history flags, and every hold that keeps it awake, from
 * pinning, audio and dialogs to recordings, profiles and page lifecycle
 * commands.
 */
export interface TabSleepTab extends Pick<BrowserProfilingState, 'codeCoverage' | 'cpuProfile' | 'memoryAllocation'> {
  id: string
  /** The tab whose page opened this one's as a window and can reach it. */
  openerTabId?: string
  url: string
  pinned: boolean
  sleeping: boolean
  loading: boolean
  audible: boolean
  lastActiveAt: number
  navigationGeneration: number
  observationGeneration: number
  suppressInitialHistory: boolean
  pendingHistoryUrl: string | null
  walletPageUnloading?: boolean
  wakePromise?: Promise<void>
  /**
   * What a tab created asleep, such as one restored behind the tab shown, waits for before it first wakes: the session
   * cookies its workspace's pages wait for.
   */
  pageReady?: Promise<void>
  /**
   * Whether the tab was created asleep to load in its turn, such as by Open all, and has not woken since. Its first load
   * is a visit, as when a tab loads at once, and putting it to sleep takes it out of its turn.
   */
  waitsForTurn?: boolean
  sleepNavigationHistory?: { entries: NavigationEntry[]; index: number }
  pageLifecycleState: BrowserPageLifecycleState
  pageLifecycleOperation?: {
    requestedState: Exclude<BrowserPageLifecycleState, 'unknown'>
    promise: Promise<BrowserPageLifecycleResult>
  }
  dialog?: BrowserJavaScriptDialog
  reproRecording?: BrowserReproRecordingInternal
  domChangesRecording?: BrowserDomRecordingState
  liveRegionRecording?: BrowserLiveRegionRecordingState
  mcpGroupId?: string
  webContents: WebContents
}

/** The tab manager option that keeps a tab with a pending wallet request awake. */
export interface TabSleepOptions {
  walletKeepsTabAwake?: (tabId: string) => boolean
}

/**
 * What putting a tab to sleep and waking it needs from the tab manager, which
 * keeps the tabs, the active tab, the split view, its options, DevTools
 * opening, native selection sessions, agent input, video recording, CSS state
 * previews, DOM mutation source captures, virtual passkeys, MCP activity, downloads, render
 * queues, navigation history, tab overview previews, the debugger queue,
 * workspaces, selection and state publication private. The active tab stays a manager field because
 * selection and layout read and write it too; it is read again at every use.
 */
export interface TabSleepAccess<Tab extends TabSleepTab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** Whether a tab with this id is open. */
  hasTab(tabId: string): boolean
  /** The open tabs. */
  tabs(): IterableIterator<Tab>
  /** The open tabs in their order. */
  orderedTabs(): Tab[]
  /** The active tab's id. */
  activeTabId(): string | null
  /** Whether the tab is one of the split view's panes. */
  splitViewContains(tabId: string): boolean
  /** Makes the tab the active tab. */
  selectTab(tabId: string): BrowserState
  /** The tab manager's options. */
  options(): TabSleepOptions
  /** The pages whose Developer Tools are opening, by WebContents id. */
  devToolsOpening(): ReadonlySet<number>
  /** The screenshot area selections in progress, by WebContents id. */
  screenshotAreaSessions(): ReadonlyMap<number, unknown>
  /** The element pickers in progress, by WebContents id. */
  elementPickerSessions(): ReadonlyMap<number, unknown>
  /** The pages receiving agent input, by WebContents id. */
  agentInputWebContents(): ReadonlyMap<number, number>
  /** The video recorder. */
  videoRecorder(): { state(tabId: string): BrowserVideoState }
  /** The forced CSS state previews. */
  cssStatePreview(): { active(tab: Tab): boolean }
  /** The armed DOM mutation source captures. */
  domMutationSource(): { active(tab: Tab): boolean }
  /** The active virtual passkeys, whose credentials sleeping would lose. */
  virtualPasskeys(): { active(tab: Tab): boolean }
  /** The armed logpoints, whose hits sleeping would miss. */
  logpoints(): { active(tab: Tab): boolean }
  /** The MCP commands running on each tab, by tab id. */
  mcpActivitiesByTab(): ReadonlyMap<string, ReadonlySet<string>>
  /** The downloads. */
  downloadController(): { hasActiveDownload(tabId: string): boolean }
  /** The page captures and PDFs rendering, by WebContents id. */
  renderQueues(): ReadonlyMap<number, Promise<void>>
  /** The tab's navigation history as it is now. */
  navigationHistorySnapshot(tab: Tab): { entries: NavigationEntry[]; index: number }
  /** The latest overview frame of each tab, by tab id. */
  tabOverviewPreviews(): ReadonlyMap<string, BrowserTabOverviewPreview>
  /** The overview frame each sleeping tab keeps showing, by tab id. */
  tabOverviewSleepPreviews(): Map<string, BrowserTabOverviewPreview>
  /** The open workspaces, by id. */
  mcpTabGroups(): ReadonlyMap<string, unknown>
  /** Runs a debugger operation on the page in its turn. */
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  /**
   * Lets the page of a tab created asleep take calls as its first load starts, and starts monitoring its dialogs and
   * network then, as for a new tab, so they are watched from its first document.
   */
  firstLoadStarts(tab: Tab): void
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** The browser state. */
  getState(): BrowserState
}
