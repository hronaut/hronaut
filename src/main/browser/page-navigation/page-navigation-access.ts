import type { WebContents } from 'electron'
import type { SearchEngineName } from '../../../shared/search-engine.js'
import type { BrowserPageProblem, BrowserState, BrowserWorkspaceNavigationAuditSource } from '../../../shared/types.js'

/**
 * The tab fields navigation reads and writes: the page, its workspace, its
 * sleep state, the page problem a reload clears, and the counters that tell a
 * policy denial or a newer document apart.
 */
export interface PageNavigationTab {
  id: string
  mcpGroupId?: string
  navigationGeneration: number
  /** Counts the documents the tab has started or shown; an address change within a page keeps it. */
  documentGeneration: number
  navigationPolicyDenialSequence: number
  sleeping: boolean
  wakePromise?: Promise<void>
  /** What a tab restored asleep waits for before it first wakes. */
  pageReady?: Promise<void>
  pageProblem?: BrowserPageProblem
  webContents: WebContents
}

/**
 * What navigation needs from the tab manager, which keeps the tabs, the
 * search engine setting, the workspace navigation policy, the diagnostic log
 * reset, renderer recovery, waking, page waits and state publication private.
 * The workspace navigation policy checks stay manager methods because tab
 * creation and page events use them too, and are called at the same points as
 * before.
 */
export interface PageNavigationAccess<Tab extends PageNavigationTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  /** The tab whose page has the keyboard, if a tab's page has it. */
  focusedTab(): Tab | undefined
  searchEngine(): SearchEngineName | undefined
  assertWorkspaceNavigationAllowed(groupId: string, url: string, source: BrowserWorkspaceNavigationAuditSource): void
  workspaceNavigationAllowed(groupId: string, url: string, source: BrowserWorkspaceNavigationAuditSource): boolean
  prepareDiagnosticNavigation(tab: Tab): void
  /** Forgets which page opened which tab of a workspace. */
  forgetTabsOpenedFrom(groupId: string): void
  isRendererRecovering(webContents: WebContents): boolean
  recoverRenderer(webContents: WebContents, loadReplacement: () => Promise<void>): Promise<void>
  wakeTab(tabId: string): Promise<BrowserState>
  waitForPage(tabId: string, timeoutMs: number): Promise<void>
  changed(persist?: boolean): void
  getState(): BrowserState
  /** Asks the person whether to leave a page that asked to confirm before it is left; true leaves it, and a question that could not be asked keeps the page. */
  confirmLeavePage(): Promise<boolean>
  /** Gives the keyboard to the page the person chose to keep, once the question over it has closed. */
  focusKeptPage(tab: Tab): void
}
