import type { BrowserWindow, WebContents, WebContentsView } from 'electron'
import type { BrowserSplitViewState } from '../../../shared/split-view.js'
import type { BrowserEmulationState, BrowserPageLifecycleState } from '../../../shared/types.js'

/**
 * The tab fields a touch gesture reads: its id, page and view, its native
 * input environment generation, whether it sleeps or is frozen, and its
 * emulation with how far it is applied.
 */
export interface AgentTouchTab {
  id: string
  webContents: WebContents
  view: WebContentsView
  nativeInputEnvironmentGeneration: number
  sleeping: boolean
  pageLifecycleState: BrowserPageLifecycleState
  emulation: BrowserEmulationState
  emulationApplication: 'confirmed' | 'pending' | 'unknown'
}

/**
 * What an agent's touch gesture needs from the tab manager, which keeps the
 * tabs, the window, the active tab, the split view and the generations of
 * both, trusted chrome occlusion, the human interaction lock and its pending
 * changes, native selection sessions, DevTools opening, the debugger queue,
 * agent input scopes and native input authority private. Each is read again at
 * every admission check.
 */
export interface AgentTouchAccess<Tab extends AgentTouchTab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** Counts tab selections. */
  tabSelectionGeneration(): number
  /** Counts split view changes. */
  splitViewGeneration(): number
  /** The split view, or null. */
  splitView(): BrowserSplitViewState | null
  /** The browser window. */
  window(): BrowserWindow
  /** The active tab's id. */
  activeTabId(): string | null
  /** Whether trusted chrome covers the page area. */
  browserContentOccluded(): boolean
  /** How many human interaction lock changes are being applied. */
  nativeInputLockMutations(): number
  /** Whether the person's input to the tab's page is locked. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** The screenshot area selections in progress, by WebContents id. */
  screenshotAreaSessions(): ReadonlyMap<number, unknown>
  /** The element pickers in progress, by WebContents id. */
  elementPickerSessions(): ReadonlyMap<number, unknown>
  /** The pages whose Developer Tools are opening, by WebContents id. */
  devToolsOpening(): ReadonlySet<number>
  /** The agent's authority to give the tab's page native input, checked and released by the caller. */
  nativeInputAuthority(tab: Tab, validateInput?: (validateContext: () => void) => void): { validate: () => void; dispose: () => void }
  /** Runs the agent's input to a page, so the page's touch events are not taken for the person's. */
  withAgentInput<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  /** Runs a debugger operation on the page in its turn. */
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
}
