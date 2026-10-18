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
