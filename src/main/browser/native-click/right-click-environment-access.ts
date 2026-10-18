import type { BrowserWindow, WebContents, WebContentsView } from 'electron'
import type { BrowserSplitViewState } from '../../../shared/split-view.js'
import type { BrowserEmulationState, BrowserPageLifecycleState } from '../../../shared/types.js'

/**
 * The tab fields a native right-click's environment reads: its id, page and
 * view, its native input environment generation, whether it sleeps or is
 * frozen, and its emulation with how far it is applied.
 */
export interface RightClickEnvironmentTab {
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
 * What admitting a native right-click needs from the tab manager, which keeps
 * the window, the active tab, the split view and the generations of both,
 * trusted chrome occlusion, the human interaction lock and its pending
 * changes, native selection sessions and DevTools opening private. Each is
 * read again at every validation.
 */
export interface RightClickEnvironmentAccess<Tab extends RightClickEnvironmentTab> {
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
}
