import type { WebContents } from 'electron'
import type { CredentialFillPageResult } from '../credential-fill-page.js'

/** The tab fields filling a saved credential reads: its id, address, navigation generation and page. */
export interface CredentialFillTab {
  id: string
  url: string
  navigationGeneration: number
  webContents: WebContents
}

/** The tab manager options filling a saved credential uses: reporting the person's interaction. */
export interface CredentialFillOptions {
  onUserInteraction?: () => void
}

/**
 * What filling a saved credential into the active tab's page needs from the
 * tab manager, which keeps the tabs, the active tab and its selection
 * generation, the agent input scope and its options private. Recording a
 * fill is trusted-credential-fill.ts's function, passed through so that
 * module still loads where the manager's own import loads it.
 */
export interface CredentialFillAccess<Tab extends CredentialFillTab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The active tab's id. */
  activeTabId(): string | null
  /** Counts tab selections, so a fill offered before another selection is refused. */
  tabSelectionGeneration(): number
  /** Runs the operation as agent input to the page. */
  withAgentInput<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  /** Records a fill the page reported as the person's interaction with the tab: trusted-credential-fill.ts's function. */
  recordTrustedCredentialFill(outcome: CredentialFillPageResult, tab: Tab, now: number, onUserInteraction?: () => void): boolean
  /** The tab manager's options. */
  options(): CredentialFillOptions
}
