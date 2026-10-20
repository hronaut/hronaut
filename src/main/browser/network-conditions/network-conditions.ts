import { randomUUID } from 'node:crypto'
import type {
  BrowserNetworkConditionState,
  BrowserNetworkRouteInput,
  BrowserNetworkRouteMoveDirection,
  BrowserNetworkRouteSummary
} from '../../../shared/types.js'
import { networkRoutePatternMatches } from '../../../shared/network-routes.js'
import { normalizeNetworkRouteInput } from '../network-route-input.js'
import { isHronautHomeUrl } from '../url.js'
import { LocalizedError } from '../../localized-error.js'
import { endHeldResponses, heldResponseCount, holdNetworkResponse, MAX_HELD_RESPONSES } from './held-responses.js'
import type { BrowserNetworkRouteRecord, NetworkConditionsAccess, NetworkConditionsTab } from './network-conditions-access.js'

/** How many request-condition rules one tab can retain. */
const MAX_NETWORK_ROUTES = 50

/** A rule removed meanwhile, for example by an agent; agents keep the message that names the rule's ID. */
function conditionGone(routeId: string): LocalizedError {
  return new LocalizedError('appErrors.networkConditions.conditionGone', undefined, { message: `Network route not found: ${routeId}` })
}

/** Whether the tab's request-condition rules are confirmed applied natively, with their public summaries. */
export function networkConditionState<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId?: string): BrowserNetworkConditionState {
  const tab = access.getTab(tabId)
  return { application: tab.networkConditionApplication, retainedRules: tab.networkRoutes.map(route => networkRouteSummary(route)) }
}

/**
 * The tab's request-condition rules. It throws unless their native
 * application is confirmed, so a caller never reports rules that may not be in
 * effect.
 */
export function networkRoutes<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId?: string): BrowserNetworkRouteSummary[] {
  const state = networkConditionState(access, tabId)
  if (state.application !== 'confirmed') throw new Error('Native request-condition application is not confirmed. Explicitly clear conditions to recover; do not replay the failed operation.')
  return state.retainedRules
}

/**
 * Checks now, and returns a check for later, that the tab's rules, their
 * native application and their epoch still match what the caller is about to
 * publish.
 */
export function networkConditionPublication<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId: string | undefined, expected: BrowserNetworkRouteSummary[]): () => void {
  const tab = access.getTab(tabId)
  const routes = tab.networkRoutes
  const epoch = tab.networkConditionEpoch
  const serialized = JSON.stringify(expected)
  const assert = (): void => {
    if (access.findTab(tab.id) !== tab || tab.webContents.isDestroyed() || tab.networkRoutes !== routes || tab.networkConditionEpoch !== epoch || tab.networkConditionApplication !== 'confirmed' || JSON.stringify(networkConditionState(access, tab.id).retainedRules) !== serialized) throw new Error('Request-condition observation changed before publication')
  }
  assert()
  return assert
}

/** Marks the tab's native rule application unknown, superseding any application under way. */
export function markNetworkConditionsUnknown(tab: NetworkConditionsTab): void {
  tab.networkConditionEpoch++
  tab.networkConditionApplication = 'unknown'
}

/** Refuses to change rules while their native application is unknown; only clearing recovers. */
export function requireNetworkConditionsKnown(tab: NetworkConditionsTab): void {
  if (tab.networkConditionApplication === 'unknown') throw new Error('Native request-condition application is unknown. Explicitly clear conditions to recover.')
}

/** Adds a rule to a website tab, up to the rule limit, and applies the rules natively. */
export async function addNetworkRoute<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId: string | undefined, input: BrowserNetworkRouteInput, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
  const tab = access.getTab(tabId)
  const normalized = normalizeNetworkRouteInput(input)
  await applyNetworkRoutes(access, tab, validate, false, () => {
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before adding a network route')
    if (tab.networkRoutes.length >= MAX_NETWORK_ROUTES) {
      throw new LocalizedError('appErrors.networkConditions.limitReached', { max: MAX_NETWORK_ROUTES }, {
        message: `Network route limit reached (${MAX_NETWORK_ROUTES})`
      })
    }
    if (normalized.hold && heldResponseCount(access, tab.webContents) + tab.networkRoutes.filter(route => route.hold).length >= MAX_HELD_RESPONSES) {
      throw new Error(`A tab can hold at most ${MAX_HELD_RESPONSES} requests, counting hold rules not matched yet. Release or cancel one first.`)
    }
    tab.networkRoutes = [...tab.networkRoutes, { ...normalized, id: randomUUID(), createdAt: new Date().toISOString() }]
  }, markSubmitted)
  return networkRoutes(access, tab.id)
}

/**
 * Enables or disables one rule. The tab, its debugger epoch, a confirmed
 * application and the rule are checked before and again at native admission.
 */
export async function setNetworkRouteEnabled<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId: string | undefined, routeId: string, enabled: boolean, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
  if (typeof enabled !== 'boolean' || !routeId) throw new TypeError('routeId and boolean enabled are required')
  const tab = access.getTab(tabId)
  const contents = tab.webContents
  const debuggerEpoch = tab.networkDebuggerEpoch
  const admission = (): void => {
    validate()
    if (access.isDestroyed() || contents.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== contents || tab.networkDebuggerEpoch !== debuggerEpoch) throw new Error('Request-condition target changed before toggle')
    if (tab.networkConditionApplication !== 'confirmed') throw new Error('Request-condition application must be confirmed before enabling or disabling a rule. Explicitly clear unknown conditions to recover.')
    if (!tab.networkRoutes.some(route => route.id === routeId)) throw conditionGone(routeId)
  }
  admission()
  await applyNetworkRoutes(access, tab, validate, false, () => {
    // Read the current record only at admission: a paused request may already
    // have reserved its budget. Never restore a caller's earlier snapshot.
    tab.networkRoutes = tab.networkRoutes.map(route => route.id === routeId ? { ...route, enabled } : route)
  }, markSubmitted, admission)
  return networkRoutes(access, tab.id)
}

/** Removes one rule and applies the remaining rules natively. */
export async function removeNetworkRoute<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId: string | undefined, routeId: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
  const tab = access.getTab(tabId)
  await applyNetworkRoutes(access, tab, validate, false, () => {
    const remaining = tab.networkRoutes.filter(route => route.id !== routeId)
    if (remaining.length === tab.networkRoutes.length) throw conditionGone(routeId)
    tab.networkRoutes = remaining
  }, markSubmitted)
  return networkRoutes(access, tab.id)
}

/** Moves one rule up or down in match order and applies the rules natively. */
export async function moveNetworkRoute<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId: string | undefined, routeId: string, direction: BrowserNetworkRouteMoveDirection, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
  const tab = access.getTab(tabId)
  await applyNetworkRoutes(access, tab, validate, false, () => {
    const index = tab.networkRoutes.findIndex(route => route.id === routeId)
    if (index < 0) throw conditionGone(routeId)
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= tab.networkRoutes.length) return
    const reordered = [...tab.networkRoutes]
    const [route] = reordered.splice(index, 1)
    reordered.splice(target, 0, route!)
    tab.networkRoutes = reordered
  }, markSubmitted)
  return networkRoutes(access, tab.id)
}

/** Removes every rule and fails every held request. As the recovery path, it applies even while the native application is unknown. */
export async function clearNetworkRoutes<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId?: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
  const tab = access.getTab(tabId)
  await applyNetworkRoutes(access, tab, validate, true, () => {
    tab.networkRoutes = []
    if (heldResponseCount(access, tab.webContents)) markSubmitted()
    endHeldResponses(access, tab.webContents, 'cleared', true)
  }, markSubmitted)
  return networkRoutes(access, tab.id)
}

/** A rule's public summary, without the response headers and body it fulfills requests with. */
function networkRouteSummary(route: BrowserNetworkRouteRecord): BrowserNetworkRouteSummary {
  return {
    id: route.id,
    enabled: route.enabled,
    urlPattern: route.urlPattern,
    ...(route.method ? { method: route.method } : {}),
    behavior: route.behavior,
    ...(route.remainingMatches !== undefined ? { remainingMatches: route.remainingMatches } : {}),
    createdAt: route.createdAt,
    ...(route.response ? { response: { ...route.response, headerNames: [...route.response.headerNames] } } : {}),
    ...(route.abort ? { abort: route.abort } : {}),
    ...(route.throttle ? { throttle: route.throttle } : {}),
    ...(route.hold ? { hold: { ...route.hold } } : {})
  }
}

/**
 * Applies the tab's rules natively in the page's debugger queue, first
 * changing them when asked: request interception for the rules that respond
 * or abort, throttling together with the emulated network conditions. It
 * refuses while the application is unknown unless recovering, and when the
 * tab, its page or its debugger epoch changed. A failure before anything was
 * sent restores the earlier rules; after that the application becomes
 * unknown. It cancels a scheduled refresh.
 */
export async function applyNetworkRoutes<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tab: Tab, validate: () => void = () => {}, recovery = false, mutate?: () => void, markSubmitted: () => void = () => {}, admission?: () => void): Promise<void> {
  const contents = tab.webContents
  const scheduled = access.networkRouteRefreshTimers().get(contents.id)
  if (scheduled) clearTimeout(scheduled)
  access.networkRouteRefreshTimers().delete(contents.id)
  const debuggerEpoch = tab.networkDebuggerEpoch
  await access.withDebugger(contents, async () => {
    validate()
    if (!recovery) requireNetworkConditionsKnown(tab)
    if (access.isDestroyed() || contents.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== contents || tab.networkDebuggerEpoch !== debuggerEpoch) throw new Error('Request-condition target changed before application')
    const previousRoutes = tab.networkRoutes
    mutate?.()
    let epoch = tab.networkConditionEpoch
    const routes = tab.networkRoutes
    // One immutable projection for Fetch and throttling, never reread between phases.
    const projection = routes.map(route => ({ ...route }))
    const network = tab.emulation.network
    let submitted = false
    const previous = tab.networkConditionApplication
    const current = (): void => {
      validate()
      if (access.isDestroyed() || contents.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== contents || tab.networkConditionEpoch !== epoch || tab.networkRoutes !== routes) throw new Error('Request-condition application was superseded')
    }
    const send = async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      current()
      if (!submitted && recovery) { tab.networkConditionEpoch++; epoch = tab.networkConditionEpoch }
      submitted = true
      markSubmitted()
      return contents.debugger.sendCommand(method, params)
    }
    tab.networkConditionApplication = 'pending'
    try {
      access.changed(false)
      const interception = projection.filter(route => route.enabled && route.behavior !== 'throttle')
      if (interception.length) await send('Fetch.enable', { patterns: [...new Set(interception.map(route => route.urlPattern))].map(urlPattern => ({ urlPattern })) })
      // Disabling interception fails held requests; empty patterns keep them and pause nothing new.
      else if (heldResponseCount(access, contents)) await send('Fetch.enable', { patterns: [] })
      else await send('Fetch.disable')
      await access.applyNetworkEmulation(contents, network, projection, send)
      // Native acknowledgement is independent of subsequent UI/MCP publication.
      if (contents.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== contents || tab.networkConditionEpoch !== epoch || tab.networkRoutes !== routes) throw new Error('Request-condition acknowledgement belongs to a retired configuration')
      tab.networkConditionApplication = 'confirmed'
    } catch (error) {
      if (access.findTab(tab.id) === tab && tab.webContents === contents && tab.networkConditionEpoch === epoch) {
        if (submitted || tab.networkRoutes !== routes) markNetworkConditionsUnknown(tab)
        else {
          tab.networkRoutes = previousRoutes
          tab.networkConditionApplication = previous
        }
        access.changed(false)
      }
      throw error
    }
    access.changed(false)
    validate()
  }, admission)
}

/**
 * Whether a hold rule may capture this request: a fetch or XMLHttpRequest
 * from the tab's top frame to the page's own origin, not a redirect. Other
 * requests pass the hold rule by, as a rule for another method would.
 */
function holdable(tab: NetworkConditionsTab, frameId: string | undefined, resourceType: string | undefined, redirectedRequestId: string | undefined, url: string): boolean {
  if (!frameId || frameId !== tab.mainFrameId || (resourceType !== 'Fetch' && resourceType !== 'XHR') || redirectedRequestId) return false
  try {
    const page = new URL(tab.url)
    return /^https?:$/.test(page.protocol) && new URL(url).origin === page.origin
  } catch {
    return false
  }
}

/**
 * Continues, fails, fulfills or holds one paused request by the first enabled rule
 * that matches it, using up one of the rule's matches, unless a newer
 * application superseded the request. A failed disposition makes the
 * application unknown and is never replayed.
 */
async function handleNetworkRouteRequest<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tab: Tab, params: unknown, requestEpoch: number): Promise<void> {
  if (tab.networkConditionEpoch !== requestEpoch) return
  const details = params as {
    requestId?: string
    request?: { url?: string; method?: string }
    frameId?: string
    resourceType?: string
    redirectedRequestId?: string
  }
  const requestId = details.requestId
  const url = details.request?.url
  const method = details.request?.method?.toUpperCase()
  if (!requestId || !url || !method || tab.webContents.isDestroyed()) return

  const ownedRoutes = tab.networkRoutes
  const route = ownedRoutes.find((candidate) => (
    candidate.enabled && (!candidate.method || candidate.method === method)
    && networkRoutePatternMatches(candidate.urlPattern, url)
    && (!candidate.hold || holdable(tab, details.frameId, details.resourceType, details.redirectedRequestId, url))
  ))

  try {
    if (!route) {
      await tab.webContents.debugger.sendCommand('Fetch.continueRequest', { requestId })
      return
    }
    if (route.behavior === 'throttle') {
      await tab.webContents.debugger.sendCommand('Fetch.continueRequest', { requestId })
      return
    }
    // Reserve the match once before disposition. Lost acknowledgements never
    // restore a consumed budget or cause a second disposition for this request.
    route.remainingMatches = (route.remainingMatches ?? 1) - 1
    if (route.remainingMatches <= 0) {
      tab.networkRoutes = tab.networkRoutes.filter(candidate => candidate !== route)
      if (tab.networkConditionApplication === 'confirmed') tab.networkConditionApplication = 'pending'
    }
    if (route.hold) {
      holdNetworkResponse(access, tab, route, requestId)
    } else if (route.behavior === 'abort') {
      await tab.webContents.debugger.sendCommand('Fetch.failRequest', {
        requestId,
        errorReason: route.abort
      })
    } else {
      const responseHeaders = Object.entries(route.responseHeaders ?? {}).map(([name, value]) => ({ name, value }))
      await tab.webContents.debugger.sendCommand('Fetch.fulfillRequest', {
        requestId,
        responseCode: route.response?.status ?? 200,
        responseHeaders,
        body: Buffer.from(route.responseBody ?? '').toString('base64')
      })
    }
    access.changed(false)
  } catch (error) {
    console.error('[browser] Could not apply network route:', error)
    // A submitted disposition may already have taken effect. Never replay it
    // as continue after losing its acknowledgement.
    if (access.findTab(tab.id) === tab && tab.networkConditionEpoch === requestEpoch) {
      markNetworkConditionsUnknown(tab)
      access.changed(false)
    }
  }
}

/** Handles a paused request after the page's earlier ones, and schedules a rule refresh once the page's queue drains. */
export function queueNetworkRouteRequest<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tab: Tab, params: unknown): void {
  const webContentsId = tab.webContents.id
  const requestEpoch = tab.networkConditionEpoch
  const previous = access.networkRouteQueues().get(webContentsId) ?? Promise.resolve()
  const queued = previous
    .catch(() => undefined)
    .then(() => handleNetworkRouteRequest(access, tab, params, requestEpoch))
    .catch((error: unknown) => console.error('[browser] Network route queue failed:', error))
  access.networkRouteQueues().set(webContentsId, queued)
  void queued.finally(() => {
    if (access.networkRouteQueues().get(webContentsId) !== queued) return
    access.networkRouteQueues().delete(webContentsId)
    scheduleNetworkRouteRefresh(access, tab)
  })
}

/**
 * Reapplies the rules 250 milliseconds after the page's paused requests
 * drain, so used-up rules leave the interception patterns once fulfilled
 * responses reached the page. It waits while requests are queued and skips a
 * closed page or an unknown application.
 */
function scheduleNetworkRouteRefresh<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tab: Tab): void {
  const webContentsId = tab.webContents.id
  const previous = access.networkRouteRefreshTimers().get(webContentsId)
  if (previous) clearTimeout(previous)
  const timer = setTimeout(() => {
    access.networkRouteRefreshTimers().delete(webContentsId)
    if (access.isDestroyed() || tab.webContents.isDestroyed() || tab.networkConditionApplication === 'unknown') return
    if (access.networkRouteQueues().has(webContentsId)) {
      scheduleNetworkRouteRefresh(access, tab)
      return
    }
    // Let fulfilled response bodies reach the page before changing Fetch patterns.
    void applyNetworkRoutes(access, tab).catch((error: unknown) => {
      if (!access.isDestroyed() && !tab.webContents.isDestroyed()) {
        console.error('[browser] Could not refresh network route patterns:', error)
      }
    })
  }, 250)
  timer.unref()
  access.networkRouteRefreshTimers().set(webContentsId, timer)
}
