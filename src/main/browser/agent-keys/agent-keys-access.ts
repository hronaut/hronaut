import type { BrowserWindow, WebContents, WebContentsView } from 'electron'
import type { BrowserSplitViewState } from '../../../shared/split-view.js'
import type { BrowserPageLifecycleState } from '../../../shared/types.js'
import type { NativeInputDispatchObserver } from '../native-key-hold.js'
import type { KeyboardDebugger } from '../native-keyboard.js'

/**
 * The tab fields an agent's key press or key hold reads: its id, page and
 * view, its native input environment generation and whether it sleeps or is
 * frozen.
 */
export interface AgentKeysTab {
  id: string
  webContents: WebContents
  view: WebContentsView
  nativeInputEnvironmentGeneration: number
  sleeping: boolean
  pageLifecycleState: BrowserPageLifecycleState
}

/**
 * What an agent's native key press and key hold need from the tab manager,
 * which keeps the tabs, the key holds, the window, the active tab, the split
 * view and the generations of both, trusted chrome occlusion, pending lock
 * changes, native selection sessions, DevTools opening, the emulation check,
 * native input authority, the agent input scope, the debugger queue and
 * authorized input commands private. Each is read again at every admission
 * check.
 */
export interface AgentKeysAccess<Tab extends AgentKeysTab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The pages holding a key now. */
  activeNativeKeyHolds(): WeakSet<WebContents>
  /** The pages whose last key release was not confirmed. */
  unconfirmedNativeKeyHolds(): WeakSet<WebContents>
  /** Counts tab selections. */
  tabSelectionGeneration(): number
  /** Counts split view changes. */
  splitViewGeneration(): number
  /** The split view, or null. */
  splitView(): BrowserSplitViewState | null
  /** How many human interaction lock changes are being applied. */
  nativeInputLockMutations(): number
  /** The active tab's id. */
  activeTabId(): string | null
  /** Whether trusted chrome covers the page area. */
  browserContentOccluded(): boolean
  /** The browser window. */
  window(): BrowserWindow
  /** The screenshot area selections in progress, by WebContents id. */
  screenshotAreaSessions(): ReadonlyMap<number, unknown>
  /** The element pickers in progress, by WebContents id. */
  elementPickerSessions(): ReadonlyMap<number, unknown>
  /** The pages whose Developer Tools are opening, by WebContents id. */
  devToolsOpening(): ReadonlySet<number>
  /** Throws unless the tab's emulation is known to be applied. */
  requireEmulationConfirmed(tab: Tab): void
  /** The agent's authority to give the tab's page native input, checked and released by the caller. */
  nativeInputAuthority(tab: Tab, validateInput?: (validateContext: () => void) => void): { validate: () => void; dispose: () => void }
  /** Runs the operation as agent input to the page. */
  withAgentInput<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  /** Runs a debugger operation on the page in its turn. */
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  /** Sends the debugger input command while the agent's input is authorized. */
  sendAuthorizedAgentInputCommand(
    webContents: WebContents,
    method: string,
    commandParams?: Record<string, unknown>,
    validateInput?: () => void,
    observer?: NativeInputDispatchObserver
  ): Promise<unknown>
  /** The page's debugger for authorized agent input, checking validateInput before each command when given. */
  agentInputDebugger(webContents: WebContents, validateInput?: () => void): KeyboardDebugger
}
