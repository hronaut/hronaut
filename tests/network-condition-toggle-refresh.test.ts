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
import { applyNetworkRoutes, clearNetworkRoutes, queueNetworkRouteRequest, removeNetworkRoute, setNetworkRouteEnabled } from '../src/main/browser/network-conditions/network-conditions.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { normalizeNetworkRouteInput } from '../src/main/browser/network-route-input.js'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/** A tab with a rule used up after one match and a rule that stays, behind a debugger queue that runs one operation at a time. */
function conditions() {
  const commands: string[] = []
  let held: (() => void) | undefined
  let holdNext: string | undefined
  const debuggerEvents = Object.assign(new EventEmitter(), {
    sendCommand: async (method: string) => {
      commands.push(method)
      if (method === holdNext) {
        holdNext = undefined
        await new Promise<void>(resolve => { held = resolve })
      }
      return {}
    },
    detach: () => undefined,
    isAttached: () => true
  })
  const contents = Object.assign(new EventEmitter(), { id: 7, debugger: debuggerEvents, isDestroyed: () => false }) as unknown as WebContents
  const rule = (id: string, times?: number) => ({
    ...normalizeNetworkRouteInput({ urlPattern: `https://app.test/${id}*`, abort: 'Failed', ...(times ? { times } : {}) }),
    id,
    createdAt: '2026-10-26T12:00:00.000Z'
  })
  const tab = {
    id: 'tab-1',
    url: 'https://app.test/page',
    webContents: contents,
    networkRoutes: [rule('once', 1), rule('kept')],
    networkConditionApplication: 'confirmed',
    networkConditionEpoch: 0,
    networkDebuggerEpoch: 0,
    mainFrameId: 'main',
    emulation: { network: 'none' as never }
  } as unknown as BrowserTab
  let queue: Promise<unknown> = Promise.resolve()
  const queues = new Map<number, Promise<void>>()
  const timers = new Map<number, NodeJS.Timeout>()
  applyNetworkEmulation.mockImplementation(async (_contents, _network, _routes, send) => { await send?.('Network.emulateNetworkConditionsByRule') })
  const withDebugger = <T>(_contents: unknown, operation: () => Promise<T>, admission?: () => void): Promise<T> => {
    const run = queue.catch(() => undefined).then(() => { admission?.(); return operation() })
    queue = run
    return run
  }
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    destroyed: false,
    withDebugger,
    networkRouteQueues: queues,
    networkRouteRefreshTimers: timers,
    heldNetworkResponseStates: new Map(),
    changed: () => {}
  } as unknown as Browser
  /** A page request, which uses up the first rule unless it asks for another address, then the paused-request queue drains. */
  const request = async (url = 'https://app.test/once') => {
    queueNetworkRouteRequest(browser, tab, { requestId: `request-${commands.length}`, request: { url, method: 'GET' }, frameId: 'main', resourceType: 'Fetch' })
    await vi.advanceTimersByTimeAsync(0)
  }
  /** Another debugger operation, such as emulation, that holds the queue until released. */
  const occupyQueue = () => {
    let free!: () => void
    void withDebugger(contents, () => new Promise<void>(resolve => { free = resolve }))
    return () => free()
  }
  return { browser, tab, commands, timers, useUpRule: () => request(), request, occupyQueue, holdNext: (method: string) => { holdNext = method }, release: () => held?.() }
}

it('toggles a rule while the refresh after a used-up rule is applying', async () => {
  const { browser, tab, commands, useUpRule, holdNext, release } = conditions()
  await applyNetworkRoutes(browser, tab)
  await useUpRule()
  expect(tab.networkConditionApplication).toBe('pending')
  // The refresh leaves interception in effect, which covers the kept rule, and settles the network conditions.
  holdNext('Network.emulateNetworkConditionsByRule')
  await vi.advanceTimersByTimeAsync(250)
  expect(commands.at(-1)).toBe('Network.emulateNetworkConditionsByRule')
  // Refused as "must be confirmed" before, as if the rules had become unknown.
  const toggled = setNetworkRouteEnabled(browser, 'tab-1', 'kept', false)
  release()
  await expect(toggled).resolves.toEqual([expect.objectContaining({ id: 'kept', enabled: false })])
  expect(tab.networkConditionApplication).toBe('confirmed')
})

it('toggles a rule before the refresh after a used-up rule, and settles the rules itself', async () => {
  const { browser, tab, timers, useUpRule } = conditions()
  await useUpRule()
  expect(timers.size).toBe(1)
  await expect(setNetworkRouteEnabled(browser, 'tab-1', 'kept', false)).resolves.toEqual([expect.objectContaining({ id: 'kept', enabled: false })])
  expect(tab.networkConditionApplication).toBe('confirmed')
  expect(timers.size).toBe(0)
})

it('keeps the refresh after a used-up rule when a change is refused before it applies', async () => {
  const { browser, tab, timers, useUpRule } = conditions()
  await useUpRule()
  // The used-up rule is gone; removing it again is refused in the queue and must not take the refresh with it.
  await expect(removeNetworkRoute(browser, 'tab-1', 'once')).rejects.toThrow('Network route not found: once')
  expect(timers.size).toBe(1)
  await vi.advanceTimersByTimeAsync(250)
  expect(tab.networkConditionApplication).toBe('confirmed')
})

it('still refuses a toggle at once while another change is applying', async () => {
  const { browser, tab, commands, holdNext, release } = conditions()
  holdNext('Fetch.enable')
  const first = setNetworkRouteEnabled(browser, 'tab-1', 'kept', false)
  await vi.advanceTimersByTimeAsync(0)
  const sent = commands.length
  await expect(setNetworkRouteEnabled(browser, 'tab-1', 'once', false)).rejects.toThrow('Another request-condition change is still applying')
  expect(commands).toHaveLength(sent)
  release()
  await first
  expect(tab.networkConditionApplication).toBe('confirmed')
  await expect(setNetworkRouteEnabled(browser, 'tab-1', 'once', false)).resolves.toHaveLength(2)
})

it('still refuses a toggle while the application is unknown', async () => {
  const { browser, tab, commands } = conditions()
  tab.networkConditionApplication = 'unknown'
  await expect(setNetworkRouteEnabled(browser, 'tab-1', 'kept', false)).rejects.toThrow('Explicitly clear unknown conditions to recover')
  expect(commands).toEqual([])
})

it('applies nothing more for a refresh that fires while a change waits in the queue', async () => {
  const { browser, tab, commands, timers, request, occupyQueue } = conditions()
  // A request no rule matches still leaves a refresh scheduled for when the page's paused requests drain.
  await request('https://app.test/other')
  expect(timers.size).toBe(1)
  const free = occupyQueue()
  const toggled = setNetworkRouteEnabled(browser, 'tab-1', 'kept', false)
  await vi.advanceTimersByTimeAsync(250)
  const sent = commands.length
  free()
  await expect(toggled).resolves.toEqual([expect.objectContaining({ id: 'once', enabled: true }), expect.objectContaining({ id: 'kept', enabled: false })])
  await vi.advanceTimersByTimeAsync(500)
  // The toggle's own application only: a refresh after it would leave the rules pending again for a moment.
  expect(commands.slice(sent).filter(method => method === 'Fetch.enable')).toHaveLength(1)
  expect(tab.networkConditionApplication).toBe('confirmed')
})

it('applies nothing more for a refresh queued while a change applies', async () => {
  const { browser, tab, commands, timers, request, holdNext, release } = conditions()
  holdNext('Fetch.enable')
  const toggled = setNetworkRouteEnabled(browser, 'tab-1', 'kept', false)
  await vi.advanceTimersByTimeAsync(0)
  // A request while the change applies schedules a refresh, which fires and waits behind the change.
  await request('https://app.test/other')
  expect(timers.size).toBe(1)
  await vi.advanceTimersByTimeAsync(250)
  expect(timers.size).toBe(0)
  const sent = commands.length
  release()
  await expect(toggled).resolves.toHaveLength(2)
  await vi.advanceTimersByTimeAsync(500)
  expect(commands.slice(sent)).not.toContain('Fetch.enable')
  expect(tab.networkConditionApplication).toBe('confirmed')
})

it('schedules the refresh again when a change it replaced fails before sending anything', async () => {
  const { browser, tab, commands, timers, useUpRule } = conditions()
  await useUpRule()
  const sent = commands.length
  // Refuses once the change is made, at the first command, as when the caller lost its authority meanwhile.
  const validate = () => { if (tab.networkRoutes.some(route => route.id === 'kept' && !route.enabled)) throw new Error('Controlled late refusal') }
  await expect(setNetworkRouteEnabled(browser, 'tab-1', 'kept', false, validate)).rejects.toThrow('Controlled late refusal')
  expect(commands).toHaveLength(sent)
  expect(tab.networkRoutes.find(route => route.id === 'kept')?.enabled).toBe(true)
  expect(tab.networkConditionApplication).toBe('pending')
  expect(timers.size).toBe(1)
  await vi.advanceTimersByTimeAsync(250)
  expect(tab.networkConditionApplication).toBe('confirmed')
  // Nothing is left counted as applying.
  await expect(setNetworkRouteEnabled(browser, 'tab-1', 'kept', false)).resolves.toEqual([expect.objectContaining({ id: 'kept', enabled: false })])
})

it('counts nothing as applying after a change that failed once sent', async () => {
  const { browser, tab } = conditions()
  applyNetworkEmulation.mockImplementation(async (_contents, _network, _routes, send) => { await send?.('Network.emulateNetworkConditionsByRule') })
  let sends = 0
  const validate = () => { if (tab.networkRoutes.some(route => route.id === 'kept' && !route.enabled) && ++sends > 1) throw new Error('Controlled failure after sending') }
  await expect(setNetworkRouteEnabled(browser, 'tab-1', 'kept', false, validate)).rejects.toThrow('Controlled failure after sending')
  expect(tab.networkConditionApplication).toBe('unknown')
  await expect(clearNetworkRoutes(browser, 'tab-1')).resolves.toEqual([])
  expect(tab.networkConditionApplication).toBe('confirmed')
})
