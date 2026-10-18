import type { WebContents } from 'electron'

/** The tab field a fill from a text file reads: its page. */
export interface TextFileFillTab {
  webContents: WebContents
}

/**
 * What an agent's fill from a text file needs from the tab manager, which
 * keeps the tabs, target validation, native input authority and the agent
 * input scope private.
 */
export interface TextFileFillAccess<Tab extends TextFileFillTab> {
  /** Throws unless the target names exactly one ref or selector. */
  validateTarget(target: { ref?: string; selector?: string }): void
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The agent's authority to change the tab's page, checked and released by the caller. */
  nativeInputAuthority(tab: Tab, validateInput?: (validateContext: () => void) => void): { validate: () => void; dispose: () => void }
  /** Runs the operation as agent input to the page. */
  withAgentInput<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
}
