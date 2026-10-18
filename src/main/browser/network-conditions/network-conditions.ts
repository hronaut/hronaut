import { randomUUID } from 'node:crypto'
import type {
  BrowserNetworkConditionState,
  BrowserNetworkRouteInput,
  BrowserNetworkRouteMoveDirection,
  BrowserNetworkRouteSummary
} from '../../../shared/types.js'
import { normalizeNetworkRouteInput } from '../network-route-input.js'
import { isHronautHomeUrl } from '../url.js'
import type { BrowserNetworkRouteRecord, NetworkConditionsAccess, NetworkConditionsTab } from './network-conditions-access.js'

/** How many request-condition rules one tab can retain. */
const MAX_NETWORK_ROUTES = 50

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
  await access.applyNetworkRoutes(tab, validate, false, () => {
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before adding a network route')
    if (tab.networkRoutes.length >= MAX_NETWORK_ROUTES) throw new Error(`Network route limit reached (${MAX_NETWORK_ROUTES})`)
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
    if (!tab.networkRoutes.some(route => route.id === routeId)) throw new Error(`Network route not found: ${routeId}`)
  }
  admission()
  await access.applyNetworkRoutes(tab, validate, false, () => {
    // Read the current record only at admission: a paused request may already
    // have reserved its budget. Never restore a caller's earlier snapshot.
    tab.networkRoutes = tab.networkRoutes.map(route => route.id === routeId ? { ...route, enabled } : route)
  }, markSubmitted, admission)
  return networkRoutes(access, tab.id)
}

/** Removes one rule and applies the remaining rules natively. */
export async function removeNetworkRoute<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId: string | undefined, routeId: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
  const tab = access.getTab(tabId)
  await access.applyNetworkRoutes(tab, validate, false, () => {
    const remaining = tab.networkRoutes.filter(route => route.id !== routeId)
    if (remaining.length === tab.networkRoutes.length) throw new Error(`Network route not found: ${routeId}`)
    tab.networkRoutes = remaining
  }, markSubmitted)
  return networkRoutes(access, tab.id)
}

/** Moves one rule up or down in match order and applies the rules natively. */
export async function moveNetworkRoute<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId: string | undefined, routeId: string, direction: BrowserNetworkRouteMoveDirection, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
  const tab = access.getTab(tabId)
  await access.applyNetworkRoutes(tab, validate, false, () => {
    const index = tab.networkRoutes.findIndex(route => route.id === routeId)
    if (index < 0) throw new Error(`Network route not found: ${routeId}`)
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= tab.networkRoutes.length) return
    const reordered = [...tab.networkRoutes]
    const [route] = reordered.splice(index, 1)
    reordered.splice(target, 0, route!)
    tab.networkRoutes = reordered
  }, markSubmitted)
  return networkRoutes(access, tab.id)
}

/** Removes every rule. As the recovery path, it applies even while the native application is unknown. */
export async function clearNetworkRoutes<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId?: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<BrowserNetworkRouteSummary[]> {
  const tab = access.getTab(tabId)
  await access.applyNetworkRoutes(tab, validate, true, () => { tab.networkRoutes = [] }, markSubmitted)
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
    ...(route.throttle ? { throttle: route.throttle } : {})
  }
}
