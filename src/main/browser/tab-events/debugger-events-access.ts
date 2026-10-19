import type { BrowserConsoleMessage, BrowserJavaScriptDialog, BrowserPageLifecycleState } from '../../../shared/types.js'
import type { BrowserNetworkRecordingState } from '../network-recording.js'

/**
 * The tab fields the page's debugger events read and write: its network
 * recording, main frame, console messages, website dialog, request-condition,
 * emulation and native input generations, and its lifecycle.
 */
export interface DebuggerEventsTab extends BrowserNetworkRecordingState {
  id: string
  url: string
  consoleMessages: BrowserConsoleMessage[]
  dialog?: BrowserJavaScriptDialog
  networkConditionApplication: 'confirmed' | 'pending' | 'unknown'
  networkConditionEpoch: number
  networkDebuggerEpoch: number
  networkDebuggerEnabled: boolean
  emulationApplication: 'confirmed' | 'pending' | 'unknown'
  emulationRevision: number
  emulationContextGeneration: number
  nativeInputEnvironmentGeneration: number
  pageLifecycleState: BrowserPageLifecycleState
  pageLifecycleUnknownRequest?: Exclude<BrowserPageLifecycleState, 'unknown'>
}

/**
 * What following the page's debugger messages and detachment needs from the
 * tab manager, which keeps request rules, network waits, console messages,
 * execution contexts, trusted chrome occlusion, website dialogs, inspector
 * issues, profiling, the CSS state preview, emulation sizing, the tabs, the
 * set of pages opening Developer Tools, dialog monitoring and state
 * publication private. The execution contexts stay a manager field because
 * page evaluation, website dialogs and closing tabs read them too; their map
 * is read and written in place. Each member reads the manager when the
 * debugger event arrives.
 */
export interface DebuggerEventsAccess<Tab extends DebuggerEventsTab> {
  /** Queues a request the page's request rules paused, to be handled in order. */
  queueNetworkRouteRequest(tab: Tab, params: unknown): void
  /** The waits for network activity. */
  networkWaitController(): { notify(tab: Tab): void }
  /** Appends a captured message to the tab's console messages. */
  appendConsoleMessage(tab: Tab, message: BrowserConsoleMessage, source: 'log' | 'runtime'): void
  /** Keeps a runtime console call until Electron's console event for it arrives. */
  retainRuntimeConsoleMessage(tab: Tab, message: BrowserConsoleMessage & { presentation?: string }): void
  /** The main world execution context of each frame of each page, by WebContents id. */
  defaultExecutionContexts(): Map<number, Map<string, { id: number; uniqueId?: string }>>
  /** Whether trusted chrome covers the pages. */
  browserContentOccluded(): boolean
  /** Dismisses a website dialog that opened while trusted chrome covers the page. */
  dismissWebsiteDialogForTrustedChrome(tab: Tab): Promise<void>
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** Records an issue the page's inspector reported. */
  addInspectorIssue(tab: Tab, value: unknown): void
  /** Profiling, which follows style sheets, debugger pauses and debugger detachment. */
  profiling(): { handleDebuggerMessage(tab: Tab, method: string, params: unknown): void; handleDebuggerDetached(tab: Tab): void }
  /** The CSS state preview, which ends when the debugger detaches. */
  cssStatePreview(): { debuggerDetached(tab: Tab): void }
  /** Sizes the tab's view for an emulated viewport, or lets it fill its space when undefined. */
  setEmulationViewSize(tab: Tab, viewport: { width: number; height: number } | undefined): void
  /** Whether the browser is closing. */
  isDestroyed(): boolean
  /** Whether a tab with this id is open. */
  hasTab(tabId: string): boolean
  /** The pages Developer Tools are opening for, by WebContents id. */
  devToolsOpening(): ReadonlySet<number>
  /** Starts monitoring the page's website dialogs, unless that is already under way. */
  ensureDialogMonitoring(tab: Tab): Promise<void>
}
