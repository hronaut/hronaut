import { buildBrowserDebugReport } from '../../../shared/debug-report.js'
import { countConsoleEvents } from '../../../shared/console-messages.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import type { BrowserDebugReport, BrowserDebugReportOptions, BrowserDiagnosticLogState } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import { currentNetworkRequests } from '../network-inspection/network-request-records.js'
import { networkRequestSummary } from '../network-inspection/network-request-summary.js'
import { getTab } from '../browser-core.js'
import { publishChange } from '../browser-state/browser-state.js'

/**
 * Builds the tab's bounded debug report from its page problem, emulation,
 * request routes, console messages and current network requests.
 */
export function debugReport(browser: Browser, options: BrowserDebugReportOptions = {}): BrowserDebugReport {
  const tab = getTab(browser, options.tabId)
  return buildBrowserDebugReport({
    tabId: tab.id,
    title: tab.title,
    url: tab.url,
    ...(tab.pageProblem ? { pageProblem: { ...tab.pageProblem } } : {}),
    ...browser.emulationProjection(tab),
    networkRouteCount: tab.networkRoutes.length,
    consoleMessages: browser.consoleMessages(tab.id),
    networkRequests: currentNetworkRequests(tab).map((request) => networkRequestSummary(request)),
    options
  })
}

/**
 * Reports which diagnostic evidence an audit of the tab can retain: the logs
 * always, DOM changes and reproduction steps while recorded for this
 * document, and storage changes while a baseline exists for its web origin.
 */
export function auditEvidenceAvailability(browser: Browser, tabId: string): {
  diagnostic: boolean
  network: boolean
  domChanges: boolean
  storageChanges: boolean
  storageSupported: boolean
  reproduction: boolean
} {
  const tab = getTab(browser, tabId)
  let origin: string | undefined
  try {
    const url = new URL(tab.url)
    if (url.protocol === 'http:' || url.protocol === 'https:') origin = url.origin
  } catch {
    // Invalid or internal URLs do not support storage-change snapshots.
  }
  return {
    diagnostic: true,
    network: true,
    domChanges: tab.domChangesRecording?.observationGeneration === tab.observationGeneration,
    storageChanges: !!origin && tab.storageComparison?.baseline.origin === origin,
    storageSupported: origin !== undefined,
    reproduction: tab.reproRecording !== undefined
  }
}

/** Counts the tab's retained console messages and current network requests, with its redacted URL. */
export function diagnosticLogState(browser: Browser, tabId?: string): BrowserDiagnosticLogState {
  const tab = getTab(browser, tabId)
  return {
    tabId: tab.id,
    url: redactNetworkUrl(tab.url),
    preserveAcrossNavigation: tab.preserveDiagnosticLogs,
    consoleMessageCount: countConsoleEvents(tab.consoleMessages.filter(message => message.observationGeneration === tab.observationGeneration)),
    networkRequestCount: currentNetworkRequests(tab).length
  }
}

/** Sets whether the tab's diagnostic logs survive navigation, then reports them. */
export function setDiagnosticLogPreservation(browser: Browser, tabId: string, preserve: boolean): BrowserDiagnosticLogState {
  const tab = getTab(browser, tabId)
  tab.preserveDiagnosticLogs = preserve
  publishChange(browser, false)
  return diagnosticLogState(browser, tab.id)
}

/** Clears the tab's retained console messages, pending runtime messages and network requests, then reports them. */
export function clearDiagnosticLogs(browser: Browser, tabId?: string): BrowserDiagnosticLogState {
  const tab = getTab(browser, tabId)
  tab.consoleMessages = []
  tab.pendingRuntimeConsoleMessages = []
  tab.networkRequests = []
  publishChange(browser, false)
  return diagnosticLogState(browser, tab.id)
}
