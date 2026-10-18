import { buildBrowserDebugReport } from '../../../shared/debug-report.js'
import { countConsoleEvents } from '../../../shared/console-messages.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import type { BrowserDebugReport, BrowserDebugReportOptions, BrowserDiagnosticLogState } from '../../../shared/types.js'
import type { DebugReportAccess, DebugReportTab } from './debug-report-access.js'

/**
 * Builds the tab's bounded debug report from its page problem, emulation,
 * request routes, console messages and current network requests.
 */
export function debugReport<Tab extends DebugReportTab>(access: DebugReportAccess<Tab>, options: BrowserDebugReportOptions = {}): BrowserDebugReport {
  const tab = access.getTab(options.tabId)
  return buildBrowserDebugReport({
    tabId: tab.id,
    title: tab.title,
    url: tab.url,
    ...(tab.pageProblem ? { pageProblem: { ...tab.pageProblem } } : {}),
    ...access.emulationProjection(tab),
    networkRouteCount: tab.networkRoutes.length,
    consoleMessages: access.consoleMessages(tab.id),
    networkRequests: access.currentNetworkRequests(tab).map((request) => access.networkRequestSummary(request)),
    options
  })
}

/**
 * Reports which diagnostic evidence an audit of the tab can retain: the logs
 * always, DOM changes and reproduction steps while recorded for this
 * document, and storage changes while a baseline exists for its web origin.
 */
export function auditEvidenceAvailability<Tab extends DebugReportTab>(access: DebugReportAccess<Tab>, tabId: string): {
  diagnostic: boolean
  network: boolean
  domChanges: boolean
  storageChanges: boolean
  storageSupported: boolean
  reproduction: boolean
} {
  const tab = access.getTab(tabId)
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
export function diagnosticLogState<Tab extends DebugReportTab>(access: DebugReportAccess<Tab>, tabId?: string): BrowserDiagnosticLogState {
  const tab = access.getTab(tabId)
  return {
    tabId: tab.id,
    url: redactNetworkUrl(tab.url),
    preserveAcrossNavigation: tab.preserveDiagnosticLogs,
    consoleMessageCount: countConsoleEvents(tab.consoleMessages.filter(message => message.observationGeneration === tab.observationGeneration)),
    networkRequestCount: access.currentNetworkRequests(tab).length
  }
}

/** Sets whether the tab's diagnostic logs survive navigation, then reports them. */
export function setDiagnosticLogPreservation<Tab extends DebugReportTab>(access: DebugReportAccess<Tab>, tabId: string, preserve: boolean): BrowserDiagnosticLogState {
  const tab = access.getTab(tabId)
  tab.preserveDiagnosticLogs = preserve
  access.changed(false)
  return diagnosticLogState(access, tab.id)
}

/** Clears the tab's retained console messages, pending runtime messages and network requests, then reports them. */
export function clearDiagnosticLogs<Tab extends DebugReportTab>(access: DebugReportAccess<Tab>, tabId?: string): BrowserDiagnosticLogState {
  const tab = access.getTab(tabId)
  tab.consoleMessages = []
  tab.pendingRuntimeConsoleMessages = []
  tab.networkRequests = []
  access.changed(false)
  return diagnosticLogState(access, tab.id)
}
