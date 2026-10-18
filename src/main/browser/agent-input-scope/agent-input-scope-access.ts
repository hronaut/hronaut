import type { BrowserWindow } from 'electron'

/**
 * What isolating window focus from an agent's work needs from the tab
 * manager, which keeps its window, its destroyed flag, the background focus
 * guard depth and the window's focusability before the guard private. The
 * depth and focusability stay manager fields because they belong to the one
 * window every guard shares; they are written back through the write members
 * and read again at every use.
 */
export interface AgentFocusIsolationAccess {
  /** The browser window. */
  window(): BrowserWindow
  /** Whether the browser is closing. */
  isDestroyed(): boolean
  /** How many agent operations are guarding the window against taking focus in the background. */
  backgroundAgentInputFocusGuardDepth(): number
  /** Records the background focus guard depth. */
  writeBackgroundAgentInputFocusGuardDepth(depth: number): void
  /** Whether the window was focusable before the first background focus guard began. */
  mainWindowFocusableBeforeAgentInput(): boolean
  /** Records whether the window was focusable before the guard. */
  writeMainWindowFocusableBeforeAgentInput(focusable: boolean): void
}

/**
 * What running an agent's input to a page needs from the tab manager on top
 * of focus isolation: which pages have agent input in flight, the person's
 * focus before it, each page's focus isolation release, the tabs, the
 * page-to-tab index, the human interaction lock and its native input guard.
 * The in-flight counts, snapshots and releases stay manager fields because
 * closing the browser clears them, and focus handling, the input guards and
 * dialog monitoring read the in-flight counts; their maps are read and
 * written in place. The tab stays opaque here: it is only handed back to the
 * lock check and the guard.
 */
export interface AgentInputScopeAccess<Tab> extends AgentFocusIsolationAccess {
  /** How many agent input operations are in flight for each page, by WebContents id. */
  agentInputWebContents(): Map<number, number>
  /** Where the person's focus was when each page's outermost agent input began, by WebContents id. */
  agentInputFocusSnapshots(): Map<number, {
    mainWindowFocused: boolean
    focusedWebContentsId: number | null
  }>
  /** The focus isolation release of each page's outermost agent input, by WebContents id. */
  agentInputFocusGuardReleases(): Map<number, () => void>
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** The id of the tab showing the page with this WebContents id. */
  tabIdForWebContents(webContentsId: number): string | undefined
  /** Whether human input to the tab is locked. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** Brings the page's native input guard in line with the tab's lock. */
  syncHumanInteractionInputGuard(tab: Tab): Promise<void>
}
