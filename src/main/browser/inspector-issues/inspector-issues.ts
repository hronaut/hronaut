import type { WebContents } from 'electron'
import { normalizeInspectorIssue } from '../../../shared/browser-issues.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import type { BrowserAuthChallengeObservation, BrowserInspectorIssue, BrowserInspectorIssuesReport } from '../../../shared/types.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { publishChange } from '../browser-state/browser-state.js'
import { ensureDialogMonitoring } from '../website-dialogs/website-dialogs.js'

/**
 * The tab fields inspector issues and HTTP authentication challenges read and
 * write. The retained issues and challenges belong to the tab, so the
 * browser's navigation, observation and workspace control handling stay
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

/** How many inspector issues one tab retains; older ones are dropped. */
const MAX_INSPECTOR_ISSUES = 200

/** How many HTTP authentication challenges one tab records before reporting truncation. */
const MAX_AUTH_CHALLENGES = 8

/**
 * Records an HTTP Basic challenge by origin and request kind only, up to the
 * limit. A main-frame navigation challenge is recorded only while a navigation
 * is pending; any other challenge only while none is and Electron reports it
 * outside the main frame, since it may otherwise come from the outgoing
 * document.
 */
export function recordAuthChallenge(tab: InspectorIssuesTab, details: Electron.AuthenticationResponseDetails, authInfo: Electron.AuthInfo): void {
  if (tab.sleeping || authInfo.isProxy || authInfo.scheme.toLowerCase() !== 'basic') return
  let origin: string
  try {
    const url = new URL(details.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    origin = url.origin
  } catch { return }
  // Electron reports isMainFrame at runtime without typing it. Only a main-frame
  // navigation challenge can belong to a pending document; anything else in
  // that window may come from the outgoing document and is not attributed.
  const isMainFrame = (details as Electron.AuthenticationResponseDetails & { isMainFrame?: unknown }).isMainFrame
  let request: BrowserAuthChallengeObservation['request']
  if (details.isRequestForNavigation && isMainFrame === true) {
    if (!tab.authNavigationPending) return
    request = 'main-frame-navigation'
  } else {
    if (tab.authNavigationPending || isMainFrame !== false) return
    request = details.isRequestForNavigation ? 'subframe-navigation' : 'subresource'
  }
  if (tab.authChallenges.length >= MAX_AUTH_CHALLENGES) {
    tab.authChallengesTruncated = true
    return
  }
  tab.authChallenges.push({ observedAt: new Date().toISOString(), scheme: 'basic', origin, request })
}

/**
 * The tab's browser-generated issues and recorded authentication challenges
 * for its current document. Unless Developer Tools owns the tab, form issues
 * are checked first. With clear, the retained issues and challenges are
 * dropped and the count cleared is reported.
 */
export async function inspectorIssues(browser: Browser, tabId?: string, clear = false): Promise<BrowserInspectorIssuesReport> {
  const tab = getTab(browser, tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before inspecting browser issues')
  if (!clear && !tab.webContents.isDevToolsOpened()) {
    await ensureDialogMonitoring(browser, tab)
    if (tab.webContents.debugger.isAttached()) {
      try {
        const checked = await tab.webContents.debugger.sendCommand('Audits.checkFormsIssues') as {
          formIssues?: unknown[]
        }
        for (const details of checked.formIssues ?? []) {
          addInspectorIssue(browser, tab, { code: 'GenericIssue', details: { genericIssueDetails: details } }, false)
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
      } catch {
        // Older Chromium builds still provide passive Audits.issueAdded events.
      }
    }
  }

  const clearedCount = clear ? tab.inspectorIssues.length : undefined
  if (clear) {
    tab.inspectorIssues = []
    tab.inspectorIssuesTruncated = false
    tab.authChallenges = []
    tab.authChallengesTruncated = false
    publishChange(browser, false)
  }
  const issues = tab.inspectorIssues.map((issue) => ({
    ...issue,
    reasons: [...issue.reasons],
    affectedUrls: [...issue.affectedUrls],
    ...(issue.source ? { source: { ...issue.source } } : {})
  }))
  return {
    tabId: tab.id,
    url: redactNetworkUrl(tab.url),
    title: tab.title,
    capturedAt: new Date().toISOString(),
    issueCount: issues.length,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length,
    infoCount: issues.filter((issue) => issue.severity === 'info').length,
    issues,
    truncated: tab.inspectorIssuesTruncated,
    authChallenges: tab.authChallenges.map((challenge) => ({ ...challenge })),
    authChallengesTruncated: tab.authChallengesTruncated,
    devToolsOpen: tab.webContents.isDevToolsOpened(),
    ...(clearedCount !== undefined ? { clearedCount } : {}),
    caveats: [
      'Issues are browser-generated diagnostics for the current document, not a complete quality audit.',
      'URLs are bounded and redact credentials, fragments, and security-related query values; cookie values and raw issue payloads are never returned.',
      'authChallenges lists HTTP Basic challenges that Hronaut observed and cancelled without supplying credentials. It reports origin and request kind only, not realm, path or login success; subresource challenges are not recorded while a top-level navigation is pending.',
      tab.webContents.isDevToolsOpened()
        ? 'Developer Tools currently owns diagnostics for this tab; close it and reload to collect new issues in Hronaut.'
        : 'Reload the page before reproducing a problem when you need issues emitted during startup.'
    ]
  }
}

/** Retains a normalized issue once by id, keeping the most recent ones up to the limit. */
export function addInspectorIssue(browser: Browser, tab: InspectorIssuesTab, value: unknown, notify = true): void {
  const issue = normalizeInspectorIssue(value)
  if (!issue || tab.inspectorIssues.some((candidate) => candidate.id === issue.id)) return
  tab.inspectorIssues.push(issue)
  if (tab.inspectorIssues.length > MAX_INSPECTOR_ISSUES) {
    tab.inspectorIssues.splice(0, tab.inspectorIssues.length - MAX_INSPECTOR_ISSUES)
    tab.inspectorIssuesTruncated = true
  }
  if (notify) publishChange(browser, false)
}
