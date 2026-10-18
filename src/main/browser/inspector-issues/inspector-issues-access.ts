import type { WebContents } from 'electron'
import type { BrowserAuthChallengeObservation, BrowserInspectorIssue } from '../../../shared/types.js'

/**
 * The tab fields inspector issues and HTTP authentication challenges read and
 * write. The retained issues and challenges belong to the tab, so the tab
 * manager's navigation, observation and workspace control handling stay
 * authoritative for clearing them.
 */
export interface InspectorIssuesTab {
  id: string
  title: string
  url: string
  sleeping: boolean
  webContents: WebContents
  inspectorIssues: BrowserInspectorIssue[]
  inspectorIssuesTruncated: boolean
  authChallenges: BrowserAuthChallengeObservation[]
  authChallengesTruncated: boolean
  /** Between a main-frame document navigation start and its commit or failure. */
  authNavigationPending: boolean
}

/**
 * What reading inspector issues needs from the tab manager, which keeps the
 * tabs, the debugger that reports issues and state publication private.
 */
export interface InspectorIssuesAccess<Tab extends InspectorIssuesTab> {
  getTab(tabId?: string): Tab
  ensureDialogMonitoring(tab: Tab): Promise<void>
  changed(persist?: boolean): void
}
