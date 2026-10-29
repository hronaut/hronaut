import type { WebContents } from 'electron'
import type { CredentialFillContext } from '../credential-fill-context.js'
import type { CredentialFillPageResult } from '../credential-fill-page.js'

/** The tab fields suggesting a password reads: its id and page. */
export interface SuggestedPasswordTab {
  id: string
  webContents: WebContents
}

/** What keeps a password Hronaut suggested: secure storage to save it in, paused agents, and the offer to save it. */
export interface SuggestedPasswordOptions {
  /** Whether passwords are saved securely; without that, a suggested password could never be filled in again. */
  available(): boolean
  /** Fills while agents are paused, as filling a saved password does, since the page then holds a password. */
  whileAgentsPaused<T>(fill: () => Promise<T>): Promise<T>
  /** Hronaut suggested this password for the website, which the offer to save it says when the page submits it. */
  suggested(origin: string, password: string): void
}

/** The tab manager options suggesting a password uses. */
export interface SuggestedPasswordManagerOptions {
  suggestedPasswords?: SuggestedPasswordOptions
  onUserInteraction?: () => void
}

/**
 * What suggesting a password in a tab's page needs from the tab manager,
 * which keeps the tabs, the active tab and its selection generation, the
 * agent input scope and its options private. Recording a fill is
 * trusted-credential-fill.ts's function, passed through as filling a saved
 * password does.
 */
export interface SuggestedPasswordAccess<Tab extends SuggestedPasswordTab> {
  findTab(tabId: string): Tab | undefined
  /** What a fill into the tab must still match: its address, navigation and selection; null when it is not the active tab. */
  credentialContext(tabId: string): CredentialFillContext | null
  /** Runs the operation as agent input to the page. */
  withAgentInput<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  /** Records a fill the page reported as the person's interaction with the tab: trusted-credential-fill.ts's function. */
  recordTrustedCredentialFill(outcome: CredentialFillPageResult, tab: Tab, now: number, onUserInteraction?: () => void): boolean
  /** The tab manager's options. */
  options(): SuggestedPasswordManagerOptions
}
