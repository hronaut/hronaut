export interface BrowserActionFailure {
  action: string
  message: string
}

export type BrowserPageProblemKind = 'load-error' | 'renderer-gone' | 'unresponsive'

export interface BrowserPageProblem {
  kind: BrowserPageProblemKind
  title: string
  message: string
  url: string
  errorCode?: number
  errorDescription?: string
  reason?: string
  exitCode?: number
}

export type BrowserJavaScriptDialogType = 'alert' | 'confirm' | 'prompt'

export interface BrowserJavaScriptDialog {
  type: BrowserJavaScriptDialogType
  message: string
  url: string
  defaultPrompt?: string
}

export type BrowserInspectorIssueSeverity = 'error' | 'warning' | 'info'

export interface BrowserInspectorIssueSource {
  url: string
  lineNumber: number
  columnNumber: number
}

export interface BrowserInspectorIssue {
  id: string
  code: string
  title: string
  severity: BrowserInspectorIssueSeverity
  cspDisposition?: 'enforce' | 'report-only' | 'unknown'
  reasons: string[]
  affectedUrls: string[]
  source?: BrowserInspectorIssueSource
  firstSeenAt: string
}

/** A passively observed HTTP Basic challenge; Hronaut never answers it. */
export interface BrowserAuthChallengeObservation {
  observedAt: string
  scheme: 'basic'
  /** Request origin only; no path, query, realm or headers. */
  origin: string
  request: 'main-frame-navigation' | 'subframe-navigation' | 'subresource'
}

export interface BrowserInspectorIssuesReport {
  tabId: string
  url: string
  title: string
  capturedAt: string
  issueCount: number
  errorCount: number
  warningCount: number
  infoCount: number
  issues: BrowserInspectorIssue[]
  truncated: boolean
  authChallenges: BrowserAuthChallengeObservation[]
  authChallengesTruncated: boolean
  devToolsOpen: boolean
  clearedCount?: number
  caveats: string[]
}

export type BrowserDialogAction = 'accept' | 'dismiss'

export interface BrowserDialogHandlingOptions {
  dialogAction?: BrowserDialogAction
  promptText?: string
}
