import { app } from 'electron'
import { basename } from 'node:path'
import { redactNetworkHeaders, redactNetworkUrl, sanitizeNetworkBody } from '../../../shared/network-details.js'
import { deriveNetworkTiming } from '../../../shared/network-timing.js'
import { parseServerTimingHeaders, serializeServerTimingMetrics } from '../../../shared/server-timing.js'
import {
  buildSanitizedNetworkHar,
  filterNetworkRequests,
  networkHarFilename,
  normalizeNetworkHarOptions
} from '../../../shared/network-har.js'
import { normalizeNetworkSearchOptions, searchNetworkDetails } from '../../../shared/network-search.js'
import { deriveNetworkRequestRelationships } from '../../../shared/network-request-relationships.js'
import { normalizeNetworkWaitOptions } from '../../../shared/network-wait.js'
import { networkReplayRequiresConfirmation, networkReplayUrlPattern } from '../../../shared/network-replay.js'
import type {
  BrowserNetworkBody,
  BrowserNetworkHar,
  BrowserNetworkHarExport,
  BrowserNetworkHarOptions,
  BrowserNetworkHarSaveOptions,
  BrowserNetworkReplayResult,
  BrowserNetworkRequest,
  BrowserNetworkRequestDetails,
  BrowserNetworkRequestRelationships,
  BrowserNetworkSearchOptions,
  BrowserNetworkSearchResult,
  BrowserNetworkWaitOptions,
  BrowserNetworkWaitResult
} from '../../../shared/types.js'
import type { BrowserNetworkRequestRecord } from '../network-recording.js'
import { isHronautHomeUrl } from '../url.js'
import { LocalizedError } from '../../localized-error.js'
import type { NetworkInspectionAccess, NetworkInspectionTab } from './network-inspection-access.js'

/** A header's value by case-insensitive name, with repeated values joined. */
function headerValue(headers: Record<string, string | string[] | undefined> | undefined, name: string): string | undefined {
  const match = Object.entries(headers ?? {}).find(([candidate]) => candidate.toLowerCase() === name.toLowerCase())?.[1]
  return Array.isArray(match) ? match.join(', ') : match
}

/** A request that left the tab's Network log; agents keep the message that names their tool and the request ID. */
function requestGone(requestId: string): LocalizedError {
  return new LocalizedError('appErrors.network.requestGone', undefined, {
    message: `Network request not found: ${requestId}. Call browser_network again for current request IDs.`
  })
}

/**
 * The tab's recorded requests for its current observation generation, as
 * public summaries. Unless Developer Tools owns the tab, the debugger that
 * records them is attached first. With clear, the recorded requests are
 * dropped after they are read.
 */
export async function networkRequests<Tab extends NetworkInspectionTab>(access: NetworkInspectionAccess<Tab>, tabId?: string, clear = false): Promise<BrowserNetworkRequest[]> {
  const tab = access.getTab(tabId)
  if (!tab.webContents.isDevToolsOpened()) await access.ensureDialogMonitoring(tab)
  const requests = access.currentNetworkRequests(tab).map((request) => access.networkRequestSummary(request))
  if (clear) tab.networkRequests = []
  return requests
}

/**
 * Waits for a request in a website tab that matches the options, from now on
 * or after a retained request cursor.
 */
export async function waitForNetworkRequest<Tab extends NetworkInspectionTab>(access: NetworkInspectionAccess<Tab>, options: BrowserNetworkWaitOptions): Promise<BrowserNetworkWaitResult> {
  const tab = access.getTab(options.tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before waiting for network activity')
  const normalized = normalizeNetworkWaitOptions(options)
  let minCaptureSequence = normalized.from === 'future' ? tab.networkCaptureSequence : 0
  if (normalized.afterRequestId) {
    const cursor = access.currentNetworkRequests(tab).find((request) => request.id === normalized.afterRequestId)
    if (!cursor) {
      throw new Error('The afterRequestId cursor is no longer retained. Call browser_network again for a current request ID.')
    }
    minCaptureSequence = cursor.captureSequence
  }
  return access.waitForNetworkActivity(tab, normalized, minCaptureSequence)
}

/**
 * Searches the sanitized details of the tab's most recent recorded requests:
 * URLs, headers, text bodies and retained stream messages.
 */
export async function networkSearch<Tab extends NetworkInspectionTab>(access: NetworkInspectionAccess<Tab>, options: BrowserNetworkSearchOptions): Promise<BrowserNetworkSearchResult> {
  const tab = access.getTab(options.tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before searching network content')
  const normalized = normalizeNetworkSearchOptions(options)
  const currentRequests = access.currentNetworkRequests(tab)
  const selected = currentRequests.slice(-normalized.maxRequests).reverse()
  const details: BrowserNetworkRequestDetails[] = []
  for (const request of selected) {
    details.push(await networkRequestDetails(access, tab.id, request.id, normalized.maxBodyChars, true))
  }
  return searchNetworkDetails({
    tabId: tab.id,
    availableRequestCount: currentRequests.length,
    details,
    options: normalized
  })
}

/**
 * A sanitized HAR log of the tab's recorded requests that match the filter,
 * with bodies only when asked for.
 */
export async function networkHar<Tab extends NetworkInspectionTab>(access: NetworkInspectionAccess<Tab>, options: BrowserNetworkHarOptions = {}): Promise<BrowserNetworkHar> {
  const tab = access.getTab(options.tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before exporting a network log')
  const normalized = normalizeNetworkHarOptions(options)
  const filtered = filterNetworkRequests(
    access.currentNetworkRequests(tab).map((request) => access.networkRequestSummary(request)),
    normalized
  )
  const selected = filtered.slice(-normalized.maxRequests)
  const details: BrowserNetworkRequestDetails[] = []
  for (const request of selected) {
    details.push(await networkRequestDetails(
      access,
      tab.id,
      request.id,
      normalized.maxBodyChars,
      normalized.includeBodies
    ))
  }
  return buildSanitizedNetworkHar({
    appVersion: app.getVersion(),
    tabId: tab.id,
    title: tab.title,
    url: redactNetworkUrl(tab.url),
    availableRequestCount: filtered.length,
    details,
    includeBodies: normalized.includeBodies,
    truncated: filtered.length > selected.length
  })
}

/** Writes the sanitized HAR log to a unique file in the downloads folder. */
export async function saveNetworkHar<Tab extends NetworkInspectionTab>(access: NetworkInspectionAccess<Tab>, options: BrowserNetworkHarSaveOptions = {}): Promise<BrowserNetworkHarExport> {
  const tab = access.getTab(options.tabId)
  const har = await networkHar(access, options)
  const data = Buffer.from(`${JSON.stringify(har, null, 2)}\n`, 'utf8')
  const path = await access.writeUniqueDownload(networkHarFilename(options.filename, tab.title), data)
  return {
    filename: basename(path),
    path,
    bytes: data.length,
    requestCount: har._hronaut.requestCount,
    sanitized: true,
    includesBodies: har._hronaut.includesBodies
  }
}

/**
 * One recorded request's sanitized headers, body, timing, relationships and
 * stream messages. The request's tab, workspace, inspection permission,
 * document and priority observation must still be current when the details
 * are returned, and deferPublication receives the same check for later.
 */
export async function networkRequestDetails<Tab extends NetworkInspectionTab>(
  access: NetworkInspectionAccess<Tab>,
  tabId: string | undefined,
  requestId: string,
  maxChars = 20_000,
  includeBody = true,
  deferPublication?: (assertCurrent: () => void) => void
): Promise<BrowserNetworkRequestDetails> {
  const tab = access.getTab(tabId)
  const request = access.currentNetworkRequests(tab).find((candidate) => candidate.id === requestId)
  if (!request) throw requestGone(requestId)
  const navigationGeneration = tab.navigationGeneration
  const priorityGeneration = tab.networkPriorityGeneration ?? 0
  const workspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? access.inspectionPermission(workspace) ?? 0 : 0
  const boundedMaxChars = Math.min(Math.max(Math.round(maxChars), 1_000), 100_000)
  const requestContentType = headerValue(request.requestHeaders, 'content-type')
  const responseContentType = request.mimeType || headerValue(request.responseHeaders, 'content-type')
  let responseBody: BrowserNetworkBody = {
    available: false,
    reason: request.eventSourceMessages
      ? 'Server-sent events are available in the bounded Event stream section.'
      : request.webSocketMessages
      ? 'WebSocket messages are available in the bounded messages section.'
      : request.detailsAvailable
        ? request.bodyAvailable ? 'Response body is no longer available from Chromium.' : 'The response body has not completed.'
        : 'Detailed capture was unavailable while Developer Tools owned this tab.'
  }

  if (!includeBody) {
    responseBody = { available: false, reason: 'Response body was omitted from this sanitized export.' }
  } else if (request.cdpRequestId && request.bodyAvailable && !request.eventSourceMessages) {
    try {
      const captured = await access.withDebugger(tab.webContents, () =>
        tab.webContents.debugger.sendCommand('Network.getResponseBody', { requestId: request.cdpRequestId })
      ) as { body?: string; base64Encoded?: boolean }
      responseBody = {
        available: true,
        ...sanitizeNetworkBody(captured.body ?? '', responseContentType, boundedMaxChars, {
          base64Encoded: captured.base64Encoded === true
        })
      }
    } catch (error) {
      responseBody = {
        available: false,
        reason: /Close Developer Tools/.test(String(error))
          ? 'Close Developer Tools for this tab, then request these details again.'
          : 'Chromium no longer has this response body in its bounded diagnostic buffer.'
      }
    }
  }
  const assertCurrent = (): void => {
    const currentWorkspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
    if (access.findTab(tab.id) !== tab || tab.webContents.isDestroyed()
      || currentWorkspace !== workspace
      || (currentWorkspace ? access.inspectionPermission(currentWorkspace) ?? 0 : 0) !== permissionGeneration
      || tab.navigationGeneration !== navigationGeneration
      || (tab.networkPriorityGeneration ?? 0) !== priorityGeneration
      || !access.currentNetworkRequests(tab).includes(request)) {
      throw new LocalizedError('appErrors.network.requestChanged', undefined, {
        message: 'Network request observation changed while reading details. Call browser_network for current request IDs.'
      })
    }
  }
  assertCurrent()
  deferPublication?.(assertCurrent)
  const timing = deriveNetworkTiming(request.resourceTiming, request.completedMonotonicSeconds)
  const serverTiming = parseServerTimingHeaders(request.responseHeaders)
  const responseHeaders = redactNetworkHeaders(request.responseHeaders)
  for (const name of Object.keys(request.responseHeaders ?? {})) {
    if (name.toLowerCase() !== 'server-timing') continue
    responseHeaders[name] = serverTiming.length
      ? serializeServerTimingMetrics(serverTiming)
      : '[invalid Server-Timing omitted]'
  }
  const relationships = networkRequestRelationships(access, tab, request)

  return {
    ...access.networkRequestSummary(request),
    priority: {
      initial: request.initialPriority ?? null,
      latestObserved: request.latestPriority ?? null
    },
    request: {
      headers: redactNetworkHeaders(request.requestHeaders),
      ...(request.requestBody !== undefined
        ? { body: sanitizeNetworkBody(request.requestBody, requestContentType, boundedMaxChars) }
        : {})
    },
    response: {
      headers: responseHeaders,
      ...(request.bodyAvailable && request.responseBodySizeBytes !== undefined
        ? { bodySizeBytes: request.responseBodySizeBytes } : {}),
      ...(request.bodyAvailable && request.responseContentSizeBytes !== undefined
        ? { contentSizeBytes: request.responseContentSizeBytes } : {}),
      ...(request.mimeType ? { mimeType: request.mimeType } : {}),
      ...(request.protocol ? { protocol: request.protocol } : {}),
      ...(serverTiming.length ? { serverTiming } : {}),
      body: responseBody
    },
    ...(timing ? { timing } : {}),
    ...(request.initiator ? { initiator: request.initiator } : {}),
    ...(relationships ? { relationships } : {}),
    ...(request.webSocketMessages ? {
      webSocket: {
        open: request.webSocketOpen === true,
        messages: request.webSocketMessages.map((message) => ({ ...message })),
        droppedMessages: request.webSocketDroppedMessages ?? 0
      }
    } : {}),
    ...(request.eventSourceMessages ? {
      eventSource: {
        open: request.completedAt === undefined,
        messages: request.eventSourceMessages.map((message) => ({ ...message })),
        droppedMessages: request.eventSourceDroppedMessages ?? 0
      }
    } : {})
  }
}

/**
 * Replays a captured XHR inside the same tab and browser session, after an
 * explicit confirmation for methods that can have side effects, and waits for
 * the replayed request to complete.
 */
export async function replayNetworkRequest<Tab extends NetworkInspectionTab>(
  access: NetworkInspectionAccess<Tab>,
  tabId: string | undefined,
  requestId: string,
  confirmSideEffects = false
): Promise<BrowserNetworkReplayResult> {
  const tab = access.getTab(tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before replaying a network request')
  const request = access.currentNetworkRequests(tab).find((candidate) => candidate.id === requestId)
  if (!request) throw requestGone(requestId)
  if (request.resourceType.toLowerCase() !== 'xhr') {
    throw new Error('Only captured XMLHttpRequest (XHR) requests can be replayed by Chromium. Fetch, document, and other request types are not supported.')
  }
  if (!request.detailsAvailable || !request.cdpRequestId) {
    throw new LocalizedError('appErrors.network.replayNeedsReload', undefined, {
      message: 'This XHR cannot be replayed because Chromium did not retain its diagnostic request ID. Close Developer Tools, reload, and capture it again.'
    })
  }

  const method = request.method.trim().toUpperCase()
  const confirmationRequired = networkReplayRequiresConfirmation(method)
  if (confirmationRequired && !confirmSideEffects) {
    throw new Error(`Replaying ${method} can repeat writes or other side effects. Pass confirmSideEffects: true only after reviewing the request.`)
  }

  const cursor = access.currentNetworkRequests(tab).at(-1)
  if (!cursor) {
    throw new LocalizedError('appErrors.network.requestGone', undefined, {
      message: 'The captured request is no longer retained. Call browser_network again for a current request ID.'
    })
  }
  try {
    await access.withDebugger(tab.webContents, () =>
      tab.webContents.debugger.sendCommand('Network.replayXHR', { requestId: request.cdpRequestId })
    )
  } catch (error) {
    if (access.isUnavailableCdpMethod(error)) {
      throw new LocalizedError('appErrors.network.replayUnsupported', undefined, { message: 'XHR replay is unavailable in this Chromium build' })
    }
    throw error
  }

  let replayed: BrowserNetworkWaitResult
  try {
    replayed = await waitForNetworkRequest(access, {
      tabId: tab.id,
      urlPattern: networkReplayUrlPattern(request.url),
      method,
      resourceType: 'xhr',
      phase: 'complete',
      afterRequestId: cursor.id,
      timeoutMs: 10_000
    })
  } catch (error) {
    // Chromium has replayed it; only its completion went unseen, such as after a timeout or a navigation.
    throw new LocalizedError('appErrors.network.replayUnconfirmed', undefined, {
      message: error instanceof Error ? error.message : String(error),
      cause: error
    })
  }
  return {
    tabId: tab.id,
    originalRequestId: request.id,
    method,
    url: redactNetworkUrl(request.url),
    replayedAt: new Date().toISOString(),
    confirmationRequired,
    confirmationAccepted: confirmationRequired && confirmSideEffects,
    replayedRequest: replayed.request,
    caveats: [
      'Chromium replayed the original XHR inside the same tab and browser session.',
      'The original body, headers, credentials, username, and password stayed inside Chromium and are not returned by this result.',
      'Inspect the new replayedRequest ID for its response, timing, or failure evidence.'
    ]
  }
}

/** The request's initiator, redirect chain and dependents among the tab's current requests. */
function networkRequestRelationships<Tab extends NetworkInspectionTab>(
  access: NetworkInspectionAccess<Tab>,
  tab: Tab,
  request: BrowserNetworkRequestRecord
): BrowserNetworkRequestRelationships | undefined {
  const relationships = deriveNetworkRequestRelationships(access.currentNetworkRequests(tab), request)
  if (!relationships) return undefined
  return {
    ...(relationships.triggeredBy
      ? { triggeredBy: access.networkRequestSummary(relationships.triggeredBy) }
      : {}),
    redirectChain: relationships.redirectChain.map((candidate) => access.networkRequestSummary(candidate)),
    dependents: relationships.dependents.map((candidate) => access.networkRequestSummary(candidate)),
    truncated: relationships.truncated
  }
}
