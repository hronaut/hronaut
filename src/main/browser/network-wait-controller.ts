import type { BrowserNetworkRequest, BrowserNetworkWaitResult } from '../../shared/types.js'
import type { NormalizedBrowserNetworkWaitOptions } from '../../shared/network-wait.js'

const MAX_NETWORK_WAITERS_PER_TAB = 20

interface NetworkWaitTab {
  id: string
  observationGeneration: number
}

interface NetworkWaiter {
  options: NormalizedBrowserNetworkWaitOptions
  minCaptureSequence: number
  observationGeneration: number
  startedAtMonotonicMs: number
  timer: NodeJS.Timeout
  resolve(result: BrowserNetworkWaitResult): void
  reject(error: Error): void
}

interface NetworkWaitHost<T> {
  matchingRequest(tab: T, options: NormalizedBrowserNetworkWaitOptions, minCaptureSequence: number): BrowserNetworkRequest | undefined
}

/** Own waiter registration, completion and timer cleanup together. */
export class BrowserNetworkWaitController<T extends NetworkWaitTab> {
  private readonly waiters = new Map<string, Set<NetworkWaiter>>()

  constructor(private readonly host: NetworkWaitHost<T>) {}

  async wait(tab: T, options: NormalizedBrowserNetworkWaitOptions, minCaptureSequence: number): Promise<BrowserNetworkWaitResult> {
    const retained = this.host.matchingRequest(tab, options, minCaptureSequence)
    if (retained) {
      return { tabId: tab.id, phase: options.phase, matchedFrom: 'retained', waitedMs: 0, request: retained }
    }
    const waiters = this.waiters.get(tab.id) ?? new Set<NetworkWaiter>()
    if (waiters.size >= MAX_NETWORK_WAITERS_PER_TAB) {
      throw new Error(`Network wait limit reached for this tab (${MAX_NETWORK_WAITERS_PER_TAB})`)
    }
    return new Promise<BrowserNetworkWaitResult>((resolve, reject) => {
      const waiter: NetworkWaiter = {
        options, minCaptureSequence,
        observationGeneration: tab.observationGeneration,
        startedAtMonotonicMs: performance.now(),
        timer: setTimeout(() => {
          this.remove(tab.id, waiter)
          reject(new Error(`Timed out after ${options.timeoutMs} ms waiting for a matching network ${options.phase}.`))
        }, options.timeoutMs),
        resolve, reject
      }
      waiter.timer.unref()
      waiters.add(waiter)
      this.waiters.set(tab.id, waiters)
      // Close the registration race if an event arrived after the retained scan.
      this.notify(tab)
    })
  }

  notify(tab: T): void {
    const waiters = this.waiters.get(tab.id)
    if (!waiters?.size) return
    for (const waiter of [...waiters]) {
      if (waiter.observationGeneration !== tab.observationGeneration) {
        clearTimeout(waiter.timer)
        this.remove(tab.id, waiter)
        waiter.reject(new Error('Workspace control changed while waiting for network activity.'))
        continue
      }
      const request = this.host.matchingRequest(tab, waiter.options, waiter.minCaptureSequence)
      if (!request) continue
      clearTimeout(waiter.timer)
      this.remove(tab.id, waiter)
      waiter.resolve({
        tabId: tab.id, phase: waiter.options.phase, matchedFrom: 'future',
        waitedMs: Math.max(0, Math.round(performance.now() - waiter.startedAtMonotonicMs)), request
      })
    }
  }

  reject(tabId: string, message: string): void {
    const waiters = this.waiters.get(tabId)
    if (!waiters?.size) return
    this.waiters.delete(tabId)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(message))
    }
  }

  dispose(): void {
    for (const tabId of this.waiters.keys()) this.reject(tabId, 'Hronaut closed while waiting for network activity.')
  }

  private remove(tabId: string, waiter: NetworkWaiter): void {
    const waiters = this.waiters.get(tabId)
    if (!waiters) return
    waiters.delete(waiter)
    if (!waiters.size) this.waiters.delete(tabId)
  }
}
