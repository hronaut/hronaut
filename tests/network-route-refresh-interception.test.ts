import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
// The browser below stubs withDebugger and changed, which request conditions run through and publish with; the
// network emulation they reapply is a stub of its own.
const { applyNetworkEmulation } = vi.hoisted(() => ({
  applyNetworkEmulation: vi.fn<(contents: unknown, network: unknown, routes: unknown, send?: (method: string) => Promise<unknown>) => Promise<void>>()
}))
vi.mock('../src/main/browser/emulation/network-emulation.js', () => ({ applyNetworkEmulation }))
vi.mock('../src/main/browser/debugger-lease/debugger-lease.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/debugger-lease/debugger-lease.js')>(),
  withDebugger: (browser: { withDebugger: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.withDebugger(...args)
}))
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist)
}))
import type { WebContents } from 'electron'
import type { BrowserNetworkRouteInput } from '../src/shared/types.js'
import { applyNetworkRoutes, queueNetworkRouteRequest, setNetworkRouteEnabled } from '../src/main/browser/network-conditions/network-conditions.js'
import { releaseHeldResponse, type HeldResponses } from '../src/main/browser/network-conditions/held-responses.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { normalizeNetworkRouteInput } from '../src/main/browser/network-route-input.js'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/** A tab with the given rules, recording each debugger command with its parameters. */
function conditions(rules: Array<{ id: string } & BrowserNetworkRouteInput>) {
  const commands: Array<{ method: string, params?: Record<string, unknown> }> = []
  const debuggerEvents = Object.assign(new EventEmitter(), {
    sendCommand: async (method: string, params?: Record<string, unknown>) => {
      commands.push({ method, ...(params ? { params } : {}) })
      return {}
    },
    detach: () => undefined,
    isAttached: () => true
  })
  const contents = Object.assign(new EventEmitter(), { id: 7, debugger: debuggerEvents, isDestroyed: () => false }) as unknown as WebContents
  const tab = {
    id: 'tab-1',
    url: 'https://app.test/page',
    webContents: contents,
    networkRoutes: rules.map(({ id, ...input }) => ({ ...normalizeNetworkRouteInput(input), id, createdAt: '2026-10-29T05:00:00.000Z' })),
    networkConditionApplication: 'confirmed',
    networkConditionEpoch: 0,
    networkDebuggerEpoch: 0,
    mainFrameId: 'main',
    emulation: { network: 'none' as never }
  } as unknown as BrowserTab
  let queue: Promise<unknown> = Promise.resolve()
  const queues = new Map<number, Promise<void>>()
  const timers = new Map<number, NodeJS.Timeout>()
  const held = new Map<number, HeldResponses>()
  applyNetworkEmulation.mockImplementation(async (_contents, _network, _routes, send) => { await send?.('Network.emulateNetworkConditionsByRule') })
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    destroyed: false,
    withDebugger: <T>(_contents: unknown, operation: () => Promise<T>, admission?: () => void): Promise<T> => {
      const run = queue.catch(() => undefined).then(() => { admission?.(); return operation() })
      queue = run
      return run
    },
    networkRouteQueues: queues,
    networkRouteRefreshTimers: timers,
    heldNetworkResponseStates: held,
    changed: () => {}
  } as unknown as Browser
  /** A page fetch, paused by interception, until the page's paused requests drain. */
  const request = async (url: string) => {
    queueNetworkRouteRequest(browser, tab, { requestId: `request-${commands.length}`, request: { url, method: 'GET' }, frameId: 'main', resourceType: 'Fetch' })
    await vi.advanceTimersByTimeAsync(0)
  }
  /** The refresh 250 ms after the page's paused requests drain. */
  const refresh = () => vi.advanceTimersByTimeAsync(250)
  const patterns = (urlPatterns: string[]) => ({ method: 'Fetch.enable', params: { patterns: urlPatterns.map(urlPattern => ({ urlPattern })) } })
  return { browser, tab, commands, request, refresh, patterns }
}

it('keeps the interception in effect when a used-up rule leaves rules it covers, so a page request is never cut off by Fetch.enable', async () => {
  const { browser, tab, commands, request, refresh, patterns } = conditions([
    { id: 'once', urlPattern: 'https://app.test/once*', response: { status: 409 }, times: 1 },
    { id: 'kept', urlPattern: 'https://app.test/kept*', response: { status: 200 } }
  ])
  await applyNetworkRoutes(browser, tab)
  expect(commands.filter(command => command.method.startsWith('Fetch.'))).toEqual([patterns(['https://app.test/once*', 'https://app.test/kept*'])])
  await request('https://app.test/once')
  expect(tab.networkRoutes.map(route => route.id)).toEqual(['kept'])
  expect(tab.networkConditionApplication).toBe('pending')
  const sent = commands.length
  await refresh()
  expect(tab.networkConditionApplication).toBe('confirmed')
  // The refresh confirms the rules and their network conditions without sending interception again.
  expect(commands.slice(sent).map(command => command.method)).toEqual(['Network.emulateNetworkConditionsByRule'])
  // A request for the used-up rule's address still pauses, and continues as no rule matches it.
  await request('https://app.test/once')
  await refresh()
  expect(commands.at(-1)).toEqual({ method: 'Fetch.continueRequest', params: { requestId: expect.any(String) } })
  expect(tab.networkConditionApplication).toBe('confirmed')
})

it('keeps the interception in effect while a used-up hold rule holds its request', async () => {
  const { browser, tab, commands, request, refresh, patterns } = conditions([
    { id: 'held', urlPattern: 'https://app.test/items*', response: { status: 200, body: 'mocked' }, holdUntilReleased: true }
  ])
  await applyNetworkRoutes(browser, tab)
  await request('https://app.test/items')
  await refresh()
  expect(tab.networkRoutes).toEqual([])
  expect(tab.networkConditionApplication).toBe('confirmed')
  // Empty patterns would keep the held request too, but sending Fetch.enable again could fail the page's next request.
  expect(commands.filter(command => command.method.startsWith('Fetch.'))).toEqual([patterns(['https://app.test/items*'])])
})

it('ends the interception left in effect once the hold it kept ended and a page request meets it', async () => {
  const { browser, tab, commands, request, refresh } = conditions([
    { id: 'held', urlPattern: 'https://app.test/items*', response: { status: 200, body: 'mocked' }, holdUntilReleased: true }
  ])
  await applyNetworkRoutes(browser, tab)
  await request('https://app.test/items')
  await refresh()
  await releaseHeldResponse(browser, undefined, 'held')
  expect(tab.networkConditionApplication).toBe('confirmed')
  await request('https://app.test/items?again')
  await refresh()
  expect(commands.filter(command => command.method.startsWith('Fetch.')).map(command => command.method)).toEqual(['Fetch.enable', 'Fetch.fulfillRequest', 'Fetch.continueRequest', 'Fetch.disable'])
  expect(tab.networkConditionApplication).toBe('confirmed')
})

it('applies nothing for a second refresh once the first kept interception that covers the rules', async () => {
  const { browser, tab, commands, request } = conditions([
    { id: 'once', urlPattern: 'https://app.test/once*', response: { status: 409 }, times: 1 },
    { id: 'kept', urlPattern: 'https://app.test/kept*', response: { status: 200 } }
  ])
  await applyNetworkRoutes(browser, tab)
  await request('https://app.test/once')
  const sent = commands.length
  await Promise.all([applyNetworkRoutes(browser, tab), applyNetworkRoutes(browser, tab)])
  expect(commands.slice(sent).map(command => command.method)).toEqual(['Network.emulateNetworkConditionsByRule'])
  expect(tab.networkConditionApplication).toBe('confirmed')
})

it('ends interception when the last rule is used up', async () => {
  const { browser, tab, commands, request, refresh } = conditions([
    { id: 'once', urlPattern: 'https://app.test/once*', response: { status: 409 }, times: 1 }
  ])
  await applyNetworkRoutes(browser, tab)
  await request('https://app.test/once')
  await refresh()
  expect(tab.networkConditionApplication).toBe('confirmed')
  expect(commands.filter(command => command.method.startsWith('Fetch.')).map(command => command.method)).toEqual(['Fetch.enable', 'Fetch.fulfillRequest', 'Fetch.disable'])
})

it('applies exactly the rules a change leaves after a refresh kept wider interception', async () => {
  const { browser, tab, commands, request, refresh, patterns } = conditions([
    { id: 'once', urlPattern: 'https://app.test/once*', response: { status: 409 }, times: 1 },
    { id: 'kept', urlPattern: 'https://app.test/kept*', response: { status: 200 } },
    { id: 'other', urlPattern: 'https://app.test/other*', response: { status: 200 } }
  ])
  await applyNetworkRoutes(browser, tab)
  await request('https://app.test/once')
  await refresh()
  await setNetworkRouteEnabled(browser, 'tab-1', 'kept', false)
  expect(commands.filter(command => command.method === 'Fetch.enable').at(-1)).toEqual(patterns(['https://app.test/other*']))
  await setNetworkRouteEnabled(browser, 'tab-1', 'other', false)
  expect(commands.filter(command => command.method.startsWith('Fetch.')).at(-1)).toEqual({ method: 'Fetch.disable' })
  expect(tab.networkConditionApplication).toBe('confirmed')
})
