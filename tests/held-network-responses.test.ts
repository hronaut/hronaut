import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { cancelHeldResponse, failAllHeldResponses, heldResponseSummaries, releaseHeldResponse, type HeldResponses } from '../src/main/browser/network-conditions/held-responses.js'
import { addNetworkRoute, applyNetworkRoutes, clearNetworkRoutes, queueNetworkRouteRequest, removeNetworkRoute } from '../src/main/browser/network-conditions/network-conditions.js'
import type { NetworkConditionsAccess, NetworkConditionsTab } from '../src/main/browser/network-conditions/network-conditions-access.js'

type Sent = { method: string; params?: Record<string, unknown> }

function fixture() {
  const sent: Sent[] = []
  const order: string[] = []
  const debuggerEvents = new EventEmitter() as EventEmitter & { sendCommand: (method: string, params?: Record<string, unknown>) => Promise<unknown>; detach: () => void; isAttached: () => boolean }
  let attached = true
  const failing = new Set<string>()
  debuggerEvents.sendCommand = async (method, params) => {
    sent.push({ method, params })
    order.push(method)
    if (failing.has(method)) throw new Error(`${method} lost its acknowledgement`)
    return {}
  }
  debuggerEvents.detach = () => { order.push('detach'); attached = false; debuggerEvents.emit('detach') }
  debuggerEvents.isAttached = () => attached
  const contents = Object.assign(new EventEmitter(), { id: 7, debugger: debuggerEvents, isDestroyed: () => false }) as unknown as WebContents
  const tab: NetworkConditionsTab = {
    id: 'tab-1',
    url: 'https://app.test/page',
    webContents: contents,
    networkRoutes: [],
    networkConditionApplication: 'confirmed',
    networkConditionEpoch: 0,
    networkDebuggerEpoch: 0,
    mainFrameId: 'main',
    emulation: { network: 'none' as never }
  }
  const held = new Map<number, HeldResponses>()
  const queues = new Map<number, Promise<void>>()
  const refreshTimers = new Map<number, NodeJS.Timeout>()
  const access: NetworkConditionsAccess<NetworkConditionsTab> = {
    getTab: () => tab,
    findTab: id => id === tab.id ? tab : undefined,
    isDestroyed: () => false,
    withDebugger: async (_contents, operation, admission) => { admission?.(); return operation() },
    applyNetworkEmulation: async () => {},
    networkRouteQueues: () => queues,
    networkRouteRefreshTimers: () => refreshTimers,
    heldNetworkResponses: () => held,
    changed: () => {}
  }
  const pause = async (requestId: string, details: Record<string, unknown> = {}): Promise<void> => {
    queueNetworkRouteRequest(access, tab, { requestId, request: { url: 'https://app.test/api/items', method: 'GET' }, frameId: 'main', resourceType: 'Fetch', ...details })
    await queues.get(contents.id)
  }
  const addHold = async (seconds = 5): Promise<string> => {
    const routes = await addNetworkRoute(access, undefined, { urlPattern: 'https://app.test/api/*', response: { status: 201, headers: { 'content-type': 'text/plain' }, body: 'done' }, holdUntilReleased: true, holdSeconds: seconds })
    return routes.at(-1)!.id
  }
  return { access, tab, contents, sent, order, failing, held, pause, addHold }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

it('holds one same-origin fetch until release, then answers it exactly once', async () => {
  const { access, sent, pause, addHold } = fixture()
  const routeId = await addHold()
  expect(sent).toContainEqual({ method: 'Fetch.enable', params: { patterns: [{ urlPattern: 'https://app.test/api/*' }] } })
  sent.length = 0
  await pause('r1')
  expect(sent).toEqual([])
  const summaries = heldResponseSummaries(access)
  expect(summaries).toEqual([{ routeId, urlPattern: 'https://app.test/api/*', heldAt: expect.any(String), expiresAt: expect.any(String) }])
  expect(JSON.stringify(summaries)).not.toContain('r1')
  const markSubmitted = vi.fn()
  await releaseHeldResponse(access, undefined, routeId, () => {}, markSubmitted)
  expect(markSubmitted).toHaveBeenCalledOnce()
  expect(sent).toEqual([{ method: 'Fetch.fulfillRequest', params: { requestId: 'r1', responseCode: 201, responseHeaders: [{ name: 'content-type', value: 'text/plain' }], body: Buffer.from('done').toString('base64') } }])
  await expect(releaseHeldResponse(access, undefined, routeId)).rejects.toThrow('its response was already released')
  expect(sent).toHaveLength(1)
})

it('lets requests a hold may not capture pass to later rules or their destination', async () => {
  const { access, tab, sent, pause, addHold } = fixture()
  const routeId = await addHold()
  sent.length = 0
  await pause('cross-origin', { request: { url: 'https://other.test/api/items', method: 'GET' } })
  await pause('frame', { frameId: 'child' })
  await pause('document', { resourceType: 'Document' })
  await pause('redirect', { redirectedRequestId: 'earlier' })
  await pause('post', { request: { url: 'https://app.test/api/items', method: 'POST' } })
  expect(sent.map(command => `${command.method}:${String(command.params?.requestId)}`)).toEqual([
    'Fetch.continueRequest:cross-origin', 'Fetch.continueRequest:frame', 'Fetch.continueRequest:document',
    'Fetch.continueRequest:redirect', 'Fetch.continueRequest:post'
  ])
  expect(heldResponseSummaries(access)).toEqual([])
  expect(tab.networkRoutes.map(route => route.id)).toEqual([routeId])
  await expect(releaseHeldResponse(access, undefined, routeId)).rejects.toThrow('has not captured a request yet')
})

it('fails a request whose hold times out, and never continues it', async () => {
  const { access, sent, pause, addHold } = fixture()
  const routeId = await addHold(5)
  await pause('r1')
  sent.length = 0
  await vi.advanceTimersByTimeAsync(5_000)
  // The rule refresh after capture leaves the interception in effect, which keeps the held request.
  expect(sent).toEqual([
    { method: 'Fetch.failRequest', params: { requestId: 'r1', errorReason: 'TimedOut' } }
  ])
  await expect(releaseHeldResponse(access, undefined, routeId)).rejects.toThrow('it timed out')
  expect(sent.some(command => command.method === 'Fetch.continueRequest' || command.method === 'Fetch.fulfillRequest')).toBe(false)
})

it('keeps interception on while a request is held, without patterns once a change leaves no rules', async () => {
  const { access, tab, sent, pause, addHold } = fixture()
  const routeId = await addHold()
  const otherId = (await addNetworkRoute(access, undefined, { urlPattern: 'https://app.test/other*', response: { status: 200 } })).at(-1)!.id
  await pause('r1')
  expect(tab.networkRoutes.map(route => route.id)).toEqual([otherId])
  sent.length = 0
  await applyNetworkRoutes(access, tab)
  // A refresh leaves the interception in effect, which covers the remaining rule and keeps the held request.
  expect(sent).toEqual([])
  await removeNetworkRoute(access, undefined, otherId)
  expect(sent).toEqual([{ method: 'Fetch.enable', params: { patterns: [] } }])
  await releaseHeldResponse(access, undefined, routeId)
  sent.length = 0
  await applyNetworkRoutes(access, tab)
  expect(sent).toEqual([{ method: 'Fetch.disable', params: undefined }])
})

it('clear fails held requests before it disables interception', async () => {
  const { access, sent, pause, addHold } = fixture()
  const routeId = await addHold()
  await pause('r1')
  sent.length = 0
  const markSubmitted = vi.fn()
  await clearNetworkRoutes(access, undefined, () => {}, markSubmitted)
  expect(sent.map(command => command.method)).toEqual(['Fetch.failRequest', 'Fetch.disable'])
  expect(sent[0]!.params).toEqual({ requestId: 'r1', errorReason: 'Aborted' })
  expect(markSubmitted).toHaveBeenCalled()
  await expect(releaseHeldResponse(access, undefined, routeId)).rejects.toThrow('request conditions were cleared')
})

it('fails held requests before a deliberate debugger detach', async () => {
  const { access, contents, order, pause, addHold } = fixture()
  const routeId = await addHold()
  await pause('r1')
  order.length = 0
  contents.debugger.detach()
  expect(order).toEqual(['Fetch.failRequest', 'detach'])
  await expect(releaseHeldResponse(access, undefined, routeId)).rejects.toThrow('the page debugger detached')
})

it('ends holds when the page navigates', async () => {
  const { access, contents, sent, pause, addHold } = fixture()
  const routeId = await addHold()
  await pause('r1')
  sent.length = 0
  contents.emit('did-navigate')
  expect(sent).toEqual([{ method: 'Fetch.failRequest', params: { requestId: 'r1', errorReason: 'Aborted' } }])
  await expect(releaseHeldResponse(access, undefined, routeId)).rejects.toThrow('the page navigated away')
})

it('refuses a release after the page debugger was replaced, failing the request instead', async () => {
  const { access, tab, sent, pause, addHold } = fixture()
  const routeId = await addHold()
  await pause('r1')
  sent.length = 0
  tab.networkDebuggerEpoch++
  await expect(releaseHeldResponse(access, undefined, routeId)).rejects.toThrow('the page debugger detached')
  expect(sent).toEqual([{ method: 'Fetch.failRequest', params: { requestId: 'r1', errorReason: 'Aborted' } }])
})

it('never answers a request twice after a release loses its acknowledgement', async () => {
  const { access, sent, failing, pause, addHold } = fixture()
  const routeId = await addHold()
  await pause('r1')
  sent.length = 0
  failing.add('Fetch.fulfillRequest')
  await expect(releaseHeldResponse(access, undefined, routeId)).rejects.toThrow('lost its acknowledgement')
  failing.clear()
  await expect(releaseHeldResponse(access, undefined, routeId)).rejects.toThrow('a release was sent but not confirmed; do not retry it')
  await expect(cancelHeldResponse(access, undefined, routeId)).rejects.toThrow('do not retry it')
  expect(sent.map(command => command.method)).toEqual(['Fetch.fulfillRequest'])
  expect(heldResponseSummaries(access)).toEqual([])
})

it('ends holds without a command when the renderer exits, and forgets the page when it is destroyed', async () => {
  const { access, contents, sent, held, pause, addHold } = fixture()
  const routeId = await addHold()
  await pause('r1')
  sent.length = 0
  contents.emit('render-process-gone')
  expect(sent).toEqual([])
  await expect(releaseHeldResponse(access, undefined, routeId)).rejects.toThrow('the page renderer exited')
  contents.emit('destroyed')
  expect(held.size).toBe(0)
})

it('fails every held request when Hronaut starts to quit', async () => {
  const { access, contents, sent, pause, addHold } = fixture()
  const routeId = await addHold()
  await pause('r1')
  sent.length = 0
  failAllHeldResponses(access, [contents])
  expect(sent).toEqual([{ method: 'Fetch.failRequest', params: { requestId: 'r1', errorReason: 'Aborted' } }])
  await expect(releaseHeldResponse(access, undefined, routeId)).rejects.toThrow('the tab closed')
})

it('cancels a held request by failing it', async () => {
  const { access, sent, pause, addHold } = fixture()
  const routeId = await addHold()
  await pause('r1')
  sent.length = 0
  await cancelHeldResponse(access, undefined, routeId)
  expect(sent).toEqual([{ method: 'Fetch.failRequest', params: { requestId: 'r1', errorReason: 'Aborted' } }])
  await expect(releaseHeldResponse(access, undefined, routeId)).rejects.toThrow('it was cancelled')
})

it('caps holds per tab, counting rules that have not matched yet, and frees a place on release', async () => {
  const { access, pause, addHold } = fixture()
  const captured = await addHold()
  await pause('r1')
  await addHold()
  await addHold()
  await addHold()
  await expect(addHold()).rejects.toThrow('at most 4 requests')
  await releaseHeldResponse(access, undefined, captured)
  await expect(addHold()).resolves.toEqual(expect.any(String))
})
