import type { WebContents } from 'electron'
import type { PointerDebugger } from '../native-pointer.js'
import type { AgentPointerIdentity } from '../page-scripts.js'

/** The tab field a file drop reads: its page. */
export interface FileDropTab {
  webContents: WebContents
}

/**
 * What a file drop needs from the tab manager, which keeps the tabs, target
 * validation, native input authority, the agent's cursor, the agent input
 * scope, the debugger lease and authorized agent input private.
 */
export interface FileDropAccess<Tab extends FileDropTab> {
  /** Throws unless the target names exactly one ref or selector. */
  validateTarget(target: { ref?: string; selector?: string }): void
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The agent's authority to give the tab's page native input, checked and released by the caller. */
  nativeInputAuthority(tab: Tab, validateInput?: (validateContext: () => void) => void): { validate: () => void; dispose: () => void }
  /** Draws the agent's cursor at the point, unless agent cursors are off. */
  showAgentPointer(webContents: WebContents, point: { x: number; y: number }, effect: 'move', options?: { agent?: AgentPointerIdentity }): Promise<void>
  /** Runs the operation as agent input to the page. */
  withAgentInput<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  /** Runs a debugger operation on the page in its turn. */
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  /** The page's debugger for authorized agent input, checking validateInput before each command when given. */
  agentInputDebugger(webContents: WebContents, validateInput?: () => void): PointerDebugger
}
