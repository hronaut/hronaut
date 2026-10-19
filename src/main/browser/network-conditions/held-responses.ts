import type { WebContents } from 'electron'
import type { BrowserHeldNetworkResponse } from '../../../shared/types.js'
import type { BrowserNetworkRouteRecord, NetworkConditionsAccess, NetworkConditionsTab } from './network-conditions-access.js'

/** How many requests one tab can hold, counting hold rules that have not matched yet. */
export const MAX_HELD_RESPONSES = 4
/** How many ended holds a tab remembers, so a late release can say why it is refused. */
const MAX_ENDED_HOLDS = 8

type HoldEnding = 'released' | 'cancelled' | 'timed-out' | 'navigated' | 'cleared' | 'detached' | 'renderer-gone' | 'closed' | 'release-failed'

interface HeldResponse {
  routeId: string
  urlPattern: string
  requestId: string
  debuggerEpoch: number
  heldAt: string
  expiresAt: string
  timer: NodeJS.Timeout
  status: number
  headers: Array<{ name: string; value: string }>
  body: string
}

/** One page's held requests and the reasons its recent holds ended. */
export interface HeldResponses {
  held: Map<string, HeldResponse>
  ended: Map<string, HoldEnding>
}

const ENDINGS: Record<HoldEnding, string> = {
  released: 'its response was already released',
  cancelled: 'it was cancelled and the request failed',
  'timed-out': 'it timed out and the request failed',
  navigated: 'the page navigated away and Chromium cancelled the request',
  cleared: 'request conditions were cleared and the request failed',
  detached: 'the page debugger detached (Developer Tools, closing or a debugger failure). Chromium normally fails the held request, but that it never reached its real destination is not confirmed',
  'renderer-gone': 'the page renderer exited',
  closed: 'the tab closed',
  'release-failed': 'a release was sent but not confirmed; do not retry it'
}

/** A release or cancel refused before anything was sent, with why and what to do instead. */
export class HoldUnavailableError extends Error {
  constructor(readonly reason: HoldEnding | 'not-captured' | 'not-held', message: string, readonly nextAction: string) {
    super(message)
    this.name = 'HoldUnavailableError'
  }
}

function holdEnded(routeId: string, ending: HoldEnding): HoldUnavailableError {
  return new HoldUnavailableError(ending, `No request is held for route ${routeId}: ${ENDINGS[ending]}.`, ending === 'release-failed' || ending === 'detached'
    ? 'Inspect the page before doing anything else; do not retry.'
    : 'Add a new hold rule and trigger the request again for another loading state.')
}

const guarded = new WeakSet<WebContents>()

/** The page's held-request state, created with its listeners on first use. */
function heldResponsesFor<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, webContents: WebContents): HeldResponses {
  const all = access.heldNetworkResponses()
  let state = all.get(webContents.id)
  if (state) return state
  state = { held: new Map(), ended: new Map() }
  all.set(webContents.id, state)
  if (!guarded.has(webContents)) {
    guarded.add(webContents)
    // Closing a page with a held request lets Chromium send it to its real
    // destination. Every deliberate detach (closing, Developer Tools) fails
    // held requests first, in the same protocol session, without waiting.
    const detach = webContents.debugger.detach.bind(webContents.debugger)
    webContents.debugger.detach = () => {
      endHeldResponses(access, webContents, 'detached', true)
      detach()
    }
    webContents.debugger.on('detach', () => endHeldResponses(access, webContents, 'detached', false))
    webContents.on('did-navigate', () => endHeldResponses(access, webContents, 'navigated', true))
    webContents.on('render-process-gone', () => endHeldResponses(access, webContents, 'renderer-gone', false))
    webContents.once('destroyed', () => {
      endHeldResponses(access, webContents, 'closed', false)
      access.heldNetworkResponses().delete(webContents.id)
    })
  }
  return state
}

/** Fails a request without waiting; a request that already ended rejects harmlessly. */
function failQuietly(webContents: WebContents, requestId: string, errorReason: 'Aborted' | 'TimedOut'): void {
  if (webContents.isDestroyed() || !webContents.debugger.isAttached()) return
  void webContents.debugger.sendCommand('Fetch.failRequest', { requestId, errorReason }).catch(() => undefined)
}

/** Forgets a hold, remembering why it ended. */
function forget(state: HeldResponses, held: HeldResponse, ending: HoldEnding): void {
  clearTimeout(held.timer)
  state.held.delete(held.routeId)
  state.ended.delete(held.routeId)
  state.ended.set(held.routeId, ending)
  while (state.ended.size > MAX_ENDED_HOLDS) state.ended.delete(state.ended.keys().next().value!)
}

/** Ends every hold of the page, failing their requests when asked and the session can still send. */
export function endHeldResponses<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, webContents: WebContents, ending: HoldEnding, fail: boolean): void {
  const state = access.heldNetworkResponses().get(webContents.id)
  if (!state?.held.size) return
  for (const held of [...state.held.values()]) {
    forget(state, held, ending)
    if (fail) failQuietly(webContents, held.requestId, 'Aborted')
  }
  if (!access.isDestroyed()) access.changed(false)
}

/** How many requests the page holds now. */
export function heldResponseCount<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, webContents: WebContents): number {
  return access.heldNetworkResponses().get(webContents.id)?.held.size ?? 0
}

/**
 * Holds a paused request the hold rule matched, without answering it, so the
 * page stays in its loading state. The request fails when the hold times out.
 */
export function holdNetworkResponse<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tab: Tab, route: BrowserNetworkRouteRecord, requestId: string): void {
  const webContents = tab.webContents
  const state = heldResponsesFor(access, webContents)
  const seconds = route.hold?.seconds ?? 30
  const heldAt = new Date()
  const timer = setTimeout(() => {
    const held = state.held.get(route.id)
    if (held?.requestId !== requestId) return
    forget(state, held, 'timed-out')
    failQuietly(webContents, requestId, 'TimedOut')
    if (!access.isDestroyed()) access.changed(false)
  }, seconds * 1000)
  timer.unref()
  state.held.set(route.id, {
    routeId: route.id,
    urlPattern: route.urlPattern,
    requestId,
    debuggerEpoch: tab.networkDebuggerEpoch,
    heldAt: heldAt.toISOString(),
    expiresAt: new Date(heldAt.getTime() + seconds * 1000).toISOString(),
    timer,
    status: route.response?.status ?? 200,
    headers: Object.entries(route.responseHeaders ?? {}).map(([name, value]) => ({ name, value })),
    body: Buffer.from(route.responseBody ?? '').toString('base64')
  })
}

/** The tab's held requests, without their URLs, headers, bodies or Chromium ids. */
export function heldResponseSummaries<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId?: string): BrowserHeldNetworkResponse[] {
  const tab = access.getTab(tabId)
  const state = access.heldNetworkResponses().get(tab.webContents.id)
  return [...(state?.held.values() ?? [])].map(held => ({ routeId: held.routeId, urlPattern: held.urlPattern, heldAt: held.heldAt, expiresAt: held.expiresAt }))
}

/**
 * Takes one held request out of its hold for release or cancellation. A hold
 * leaves the page's state before anything is sent, so a second call can never
 * answer the request twice.
 */
function takeHeldResponse<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tab: Tab, routeId: string, validate: () => void): { state: HeldResponses; held: HeldResponse } {
  const state = access.heldNetworkResponses().get(tab.webContents.id)
  const held = state?.held.get(routeId)
  if (!state || !held) {
    const ending = state?.ended.get(routeId)
    if (ending) throw holdEnded(routeId, ending)
    if (tab.networkRoutes.some(route => route.id === routeId && route.hold)) {
      throw new HoldUnavailableError('not-captured', `Route ${routeId} has not captured a request yet.`, 'Trigger the request in the page, then check action held before releasing.')
    }
    throw new HoldUnavailableError('not-held', `No request is held for route ${routeId}.`, 'Check action held for the routeId of a captured request.')
  }
  validate()
  if (access.isDestroyed() || tab.webContents.isDestroyed() || access.findTab(tab.id) !== tab || tab.networkDebuggerEpoch !== held.debuggerEpoch) {
    failQuietly(tab.webContents, held.requestId, 'Aborted')
    forget(state, held, 'detached')
    throw holdEnded(routeId, 'detached')
  }
  return { state, held }
}

/** Answers one held request with its rule's mock response, exactly once. */
export async function releaseHeldResponse<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId: string | undefined, routeId: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<void> {
  const tab = access.getTab(tabId)
  const { state, held } = takeHeldResponse(access, tab, routeId, validate)
  forget(state, held, 'release-failed')
  access.changed(false)
  markSubmitted()
  await tab.webContents.debugger.sendCommand('Fetch.fulfillRequest', {
    requestId: held.requestId,
    responseCode: held.status,
    responseHeaders: held.headers,
    body: held.body
  })
  state.ended.set(routeId, 'released')
}

/** Fails one held request instead of answering it. */
export async function cancelHeldResponse<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, tabId: string | undefined, routeId: string, validate: () => void = () => {}, markSubmitted: () => void = () => {}): Promise<void> {
  const tab = access.getTab(tabId)
  const { state, held } = takeHeldResponse(access, tab, routeId, validate)
  forget(state, held, 'cancelled')
  access.changed(false)
  markSubmitted()
  await tab.webContents.debugger.sendCommand('Fetch.failRequest', { requestId: held.requestId, errorReason: 'Aborted' })
}

/**
 * Fails every held request of these pages as Hronaut starts to quit, before
 * its tabs close, so no page closes with a request still paused.
 */
export function failAllHeldResponses<Tab extends NetworkConditionsTab>(access: NetworkConditionsAccess<Tab>, pages: Iterable<WebContents>): void {
  for (const webContents of pages) if (!webContents.isDestroyed()) endHeldResponses(access, webContents, 'closed', true)
}

/** Stops every hold timer when the browser closes; tabs fail their held requests as their debuggers detach. */
export function disposeHeldResponses(all: Map<number, HeldResponses>): void {
  for (const state of all.values()) for (const held of state.held.values()) clearTimeout(held.timer)
  all.clear()
}
