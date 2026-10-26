import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { queueNetworkRouteRequest, removeNetworkRoute, setNetworkRouteEnabled } from '../src/main/browser/network-conditions/network-conditions.js'
import type { NetworkConditionsAccess, NetworkConditionsTab } from '../src/main/browser/network-conditions/network-conditions-access.js'
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
  const tab: NetworkConditionsTab = {
    id: 'tab-1',
    url: 'https://app.test/page',
    webContents: contents,
    networkRoutes: [rule('once', 1), rule('kept')],
    networkConditionApplication: 'confirmed',
    networkConditionEpoch: 0,
    networkDebuggerEpoch: 0,
    mainFrameId: 'main',
    emulation: { network: 'none' as never }
  }
  let queue: Promise<unknown> = Promise.resolve()
  const queues = new Map<number, Promise<void>>()
  const timers = new Map<number, NodeJS.Timeout>()
  const access: NetworkConditionsAccess<NetworkConditionsTab> = {
    getTab: () => tab,
    findTab: id => id === tab.id ? tab : undefined,
    isDestroyed: () => false,
    withDebugger: (_contents, operation, admission) => {
      const run = queue.catch(() => undefined).then(() => { admission?.(); return operation() })
      queue = run
      return run
    },
    applyNetworkEmulation: async () => {},
    networkRouteQueues: () => queues,
    networkRouteRefreshTimers: () => timers,
    heldNetworkResponses: () => new Map(),
    changed: () => {}
  }
  /** A page request that uses up the first rule, then the paused-request queue drains. */
  const useUpRule = async () => {
    queueNetworkRouteRequest(access, tab, { requestId: 'request-1', request: { url: 'https://app.test/once', method: 'GET' }, frameId: 'main', resourceType: 'Fetch' })
    await vi.advanceTimersByTimeAsync(0)
  }
  return { access, tab, commands, timers, useUpRule, holdNext: (method: string) => { holdNext = method }, release: () => held?.() }
}

it('toggles a rule while the refresh after a used-up rule is applying', async () => {
  const { access, tab, commands, useUpRule, holdNext, release } = conditions()
  await useUpRule()
  expect(tab.networkConditionApplication).toBe('pending')
  holdNext('Fetch.enable')
  await vi.advanceTimersByTimeAsync(250)
  expect(commands.at(-1)).toBe('Fetch.enable')
  // Refused as "must be confirmed" before, as if the rules had become unknown.
  const toggled = setNetworkRouteEnabled(access, 'tab-1', 'kept', false)
  release()
  await expect(toggled).resolves.toEqual([expect.objectContaining({ id: 'kept', enabled: false })])
  expect(tab.networkConditionApplication).toBe('confirmed')
})

it('toggles a rule before the refresh after a used-up rule, and settles the rules itself', async () => {
  const { access, tab, timers, useUpRule } = conditions()
  await useUpRule()
  expect(timers.size).toBe(1)
  await expect(setNetworkRouteEnabled(access, 'tab-1', 'kept', false)).resolves.toEqual([expect.objectContaining({ id: 'kept', enabled: false })])
  expect(tab.networkConditionApplication).toBe('confirmed')
  expect(timers.size).toBe(0)
})

it('keeps the refresh after a used-up rule when a change is refused before it applies', async () => {
  const { access, tab, timers, useUpRule } = conditions()
  await useUpRule()
  // The used-up rule is gone; removing it again is refused in the queue and must not take the refresh with it.
  await expect(removeNetworkRoute(access, 'tab-1', 'once')).rejects.toThrow('Network route not found: once')
  expect(timers.size).toBe(1)
  await vi.advanceTimersByTimeAsync(250)
  expect(tab.networkConditionApplication).toBe('confirmed')
})

it('still refuses a toggle at once while another change is applying', async () => {
  const { access, tab, commands, holdNext, release } = conditions()
  holdNext('Fetch.enable')
  const first = setNetworkRouteEnabled(access, 'tab-1', 'kept', false)
  await vi.advanceTimersByTimeAsync(0)
  const sent = commands.length
  await expect(setNetworkRouteEnabled(access, 'tab-1', 'once', false)).rejects.toThrow('Another request-condition change is still applying')
  expect(commands).toHaveLength(sent)
  release()
  await first
  expect(tab.networkConditionApplication).toBe('confirmed')
  await expect(setNetworkRouteEnabled(access, 'tab-1', 'once', false)).resolves.toHaveLength(2)
})

it('still refuses a toggle while the application is unknown', async () => {
  const { access, tab, commands } = conditions()
  tab.networkConditionApplication = 'unknown'
  await expect(setNetworkRouteEnabled(access, 'tab-1', 'kept', false)).rejects.toThrow('Explicitly clear unknown conditions to recover')
  expect(commands).toEqual([])
})
