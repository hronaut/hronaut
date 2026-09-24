import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserNetworkWaitController } from '../src/main/browser/network-wait-controller.js'
import { normalizeNetworkWaitOptions } from '../src/shared/network-wait.js'
import type { BrowserNetworkRequest } from '../src/shared/types.js'

const options = normalizeNetworkWaitOptions({ urlPattern: '*', timeoutMs: 100 })
const request: BrowserNetworkRequest = {
  id: 'request-1', url: 'https://example.test/', method: 'GET', resourceType: 'fetch',
  startedAt: '2026-09-24T00:00:00.000Z', status: 200, detailsAvailable: false
}

function fixture() {
  vi.useFakeTimers()
  const matchingRequest = vi.fn<() => BrowserNetworkRequest | undefined>(() => undefined)
  const controller = new BrowserNetworkWaitController({ matchingRequest })
  const tab = { id: 'tab-1', observationGeneration: 1 }
  return { controller, matchingRequest, tab }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('network wait lifecycle', () => {
  it('returns a retained request without creating a timer', async () => {
    const f = fixture()
    f.matchingRequest.mockReturnValue(request)
    await expect(f.controller.wait(f.tab, options, 7)).resolves.toMatchObject({ matchedFrom: 'retained', waitedMs: 0, request })
    expect(f.matchingRequest).toHaveBeenCalledWith(f.tab, options, 7)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resolves a request that arrives during registration and clears its timer', async () => {
    const f = fixture()
    f.matchingRequest.mockReturnValueOnce(undefined).mockReturnValueOnce(request)
    await expect(f.controller.wait(f.tab, options, 0)).resolves.toMatchObject({ matchedFrom: 'future', request })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a waiter when workspace ownership changes before a matching event', async () => {
    const f = fixture()
    const pending = expect(f.controller.wait(f.tab, options, 0)).rejects.toThrow('Workspace control changed')
    f.tab.observationGeneration++
    f.matchingRequest.mockReturnValue(request)
    f.controller.notify(f.tab)
    await pending
    expect(vi.getTimerCount()).toBe(0)
  })

  it('enforces the per-tab limit and releases every slot on timeout', async () => {
    const f = fixture()
    const waits = Array.from({ length: 20 }, () => expect(f.controller.wait(f.tab, options, 0)).rejects.toThrow('Timed out after 100 ms'))
    await expect(f.controller.wait(f.tab, options, 0)).rejects.toThrow('Network wait limit reached')
    await vi.advanceTimersByTimeAsync(100)
    await Promise.all(waits)
    const next = expect(f.controller.wait(f.tab, options, 0)).rejects.toThrow('Tab closed')
    f.controller.reject(f.tab.id, 'Tab closed')
    await next
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([-60_000, 60_000])('measures elapsed time independently of a %i ms clock adjustment', async shift => {
    const f = fixture()
    vi.setSystemTime(100_000)
    const monotonic = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const pending = f.controller.wait(f.tab, options, 0)
    vi.setSystemTime(100_000 + shift)
    monotonic.mockReturnValue(1_400)
    f.matchingRequest.mockReturnValue(request)
    f.controller.notify(f.tab)
    await expect(pending).resolves.toMatchObject({ waitedMs: 400 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('isolates tab cancellation and rejects remaining waits during disposal', async () => {
    const f = fixture()
    const first = expect(f.controller.wait(f.tab, options, 0)).rejects.toThrow('Tab closed')
    const other = expect(f.controller.wait({ ...f.tab, id: 'tab-2' }, options, 0)).rejects.toThrow('Hronaut closed')
    f.controller.reject(f.tab.id, 'Tab closed')
    await first
    expect(vi.getTimerCount()).toBe(1)
    f.controller.dispose()
    await other
    expect(vi.getTimerCount()).toBe(0)
  })
})
