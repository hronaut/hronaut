import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../src/main/browser/browser-core.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-core.js')>(),
  getTab: (browser: Inspection, tabId?: string) => browser.getTab(tabId),
  findTab: (browser: Inspection, tabId: string) => browser.findTab(tabId)
}))
vi.mock('../src/main/browser/debugger-lease/debugger-lease.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/debugger-lease/debugger-lease.js')>(),
  withDebugger: (browser: Inspection, webContents: WebContents, operation: () => Promise<unknown>) => browser.withDebugger(webContents, operation)
}))
import { networkRequestDetails, replayNetworkRequest } from '../src/main/browser/network-inspection/network-inspection.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import type { BrowserNetworkRequestRecord } from '../src/main/browser/network-recording.js'
import { LocalizedError } from '../src/main/localized-error.js'
import { translate } from '../src/shared/i18n.js'

function record(overrides: Partial<BrowserNetworkRequestRecord> = {}): BrowserNetworkRequestRecord {
  return {
    id: 'request-1',
    url: 'https://example.test/api',
    method: 'GET',
    resourceType: 'xhr',
    startedAt: '2026-10-20T12:00:00.000Z',
    completedAt: '2026-10-20T12:00:00.100Z',
    status: 200,
    detailsAvailable: true,
    cdpRequestId: 'cdp-1',
    captureSequence: 1,
    observationGeneration: 0,
    ...overrides
  }
}

/** The browser's parts network inspection reads, with the tab found or gone and the debugger and network waits faked. */
interface Inspection {
  getTab(tabId?: string): BrowserTab
  findTab(tabId: string): BrowserTab | undefined
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  isUnavailableCdpMethod(error: unknown): boolean
  networkWaitController: { wait(tab: BrowserTab, options: { timeoutMs: number }, minCaptureSequence: number): Promise<never> }
}

function inspection(requests: BrowserNetworkRequestRecord[], overrides: Partial<Inspection> = {}) {
  const tab = {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/',
    navigationGeneration: 0,
    networkRequests: requests,
    networkCaptureSequence: requests.length,
    observationGeneration: 0,
    webContents: { isDestroyed: () => false, debugger: { sendCommand: vi.fn() } } as unknown as WebContents
  } as BrowserTab
  const inspected: Inspection = {
    getTab: () => tab,
    findTab: () => tab,
    withDebugger: async (_webContents, operation) => await operation(),
    isUnavailableCdpMethod: () => false,
    networkWaitController: { wait: async () => { throw new Error('Not used') } },
    ...overrides
  }
  return Object.assign(inspected, { mcpTabGroups: new Map(), inspectionPermissions: new WeakMap() }) as unknown as Browser
}

async function failure(operation: Promise<unknown>): Promise<LocalizedError> {
  const error = await operation.then(() => undefined, (cause: unknown) => cause)
  expect(error).toBeInstanceOf(LocalizedError)
  return error as LocalizedError
}

describe('Network panel request errors', () => {
  // The Network panel showed these in English in every interface language, worded for agents and their tools.
  it('names a request that left the log for the panel and keeps the agent message', async () => {
    const browser = inspection([])
    const details = await failure(networkRequestDetails(browser, 'tab-1', 'request-9'))
    expect(details.key).toBe('appErrors.network.requestGone')
    expect(details.message).toBe('Network request not found: request-9. Call browser_network again for current request IDs.')
    const replay = await failure(replayNetworkRequest(browser, 'tab-1', 'request-9'))
    expect(replay.key).toBe('appErrors.network.requestGone')
    expect(replay.message).toBe(details.message)
    expect(translate('de-DE', replay.key)).toBe('Diese Anfrage ist nicht mehr im Netzwerkprotokoll. Aktualisieren Sie die Liste, um die aktuellen Anfragen zu sehen.')
  })

  it('names a request whose page changed while its details were read', async () => {
    const browser = inspection([record()], { findTab: () => undefined })
    const error = await failure(networkRequestDetails(browser, 'tab-1', 'request-1'))
    expect(error.key).toBe('appErrors.network.requestChanged')
    expect(error.message).toBe('Network request observation changed while reading details. Call browser_network for current request IDs.')
  })

  it('names a replay Chromium cannot make without a reload', async () => {
    const error = await failure(replayNetworkRequest(inspection([record({ cdpRequestId: undefined })]), 'tab-1', 'request-1'))
    expect(error.key).toBe('appErrors.network.replayNeedsReload')
    expect(error.message).toBe('This XHR cannot be replayed because Chromium did not retain its diagnostic request ID. Close Developer Tools, reload, and capture it again.')
  })

  it('names a Chromium that cannot replay requests', async () => {
    const browser = inspection([record()], {
      withDebugger: async () => { throw new Error("'Network.replayXHR' wasn't found") },
      isUnavailableCdpMethod: () => true
    })
    const error = await failure(replayNetworkRequest(browser, 'tab-1', 'request-1'))
    expect(error.key).toBe('appErrors.network.replayUnsupported')
    expect(error.message).toBe('XHR replay is unavailable in this Chromium build')
    expect(translate('uk-UA', error.key)).toBe('Ця версія Chromium не може повторювати запити.')
  })

  it('names a replay whose new request Hronaut did not see finish', async () => {
    const browser = inspection([record()], {
      networkWaitController: { wait: async (_tab, options) => { throw new Error(`Timed out after ${options.timeoutMs} ms waiting for a matching network complete.`) } }
    })
    const error = await failure(replayNetworkRequest(browser, 'tab-1', 'request-1'))
    expect(error.key).toBe('appErrors.network.replayUnconfirmed')
    expect(error.message).toBe('Timed out after 10000 ms waiting for a matching network complete.')
  })
})
