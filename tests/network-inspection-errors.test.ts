import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
import { networkRequestDetails, replayNetworkRequest } from '../src/main/browser/network-inspection/network-inspection.js'
import type { NetworkInspectionAccess, NetworkInspectionTab } from '../src/main/browser/network-inspection/network-inspection-access.js'
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

function inspection(requests: BrowserNetworkRequestRecord[], overrides: Partial<NetworkInspectionAccess<NetworkInspectionTab>> = {}) {
  const tab: NetworkInspectionTab = {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/',
    navigationGeneration: 0,
    networkRequests: requests,
    networkCaptureSequence: requests.length,
    webContents: { isDestroyed: () => false, debugger: { sendCommand: vi.fn() } } as unknown as WebContents
  }
  const access: NetworkInspectionAccess<NetworkInspectionTab> = {
    getTab: () => tab,
    findTab: () => tab,
    findWorkspace: () => undefined,
    inspectionPermission: () => undefined,
    ensureDialogMonitoring: async () => undefined,
    currentNetworkRequests: () => tab.networkRequests,
    networkRequestSummary: (request) => request,
    waitForNetworkActivity: async () => { throw new Error('Not used') },
    writeUniqueDownload: async () => '/tmp/network.har',
    withDebugger: async (_webContents, operation) => await operation(),
    isUnavailableCdpMethod: () => false,
    ...overrides
  }
  return access
}

async function failure(operation: Promise<unknown>): Promise<LocalizedError> {
  const error = await operation.then(() => undefined, (cause: unknown) => cause)
  expect(error).toBeInstanceOf(LocalizedError)
  return error as LocalizedError
}

describe('Network panel request errors', () => {
  // The Network panel showed these in English in every interface language, worded for agents and their tools.
  it('names a request that left the log for the panel and keeps the agent message', async () => {
    const access = inspection([])
    const details = await failure(networkRequestDetails(access, 'tab-1', 'request-9'))
    expect(details.key).toBe('appErrors.network.requestGone')
    expect(details.message).toBe('Network request not found: request-9. Call browser_network again for current request IDs.')
    const replay = await failure(replayNetworkRequest(access, 'tab-1', 'request-9'))
    expect(replay.key).toBe('appErrors.network.requestGone')
    expect(replay.message).toBe(details.message)
    expect(translate('de-DE', replay.key)).toBe('Diese Anfrage ist nicht mehr im Netzwerkprotokoll. Aktualisieren Sie die Liste und wählen Sie sie erneut aus.')
  })

  it('names a request whose page changed while its details were read', async () => {
    const access = inspection([record()], { findTab: () => undefined })
    const error = await failure(networkRequestDetails(access, 'tab-1', 'request-1'))
    expect(error.key).toBe('appErrors.network.requestChanged')
    expect(error.message).toBe('Network request observation changed while reading details. Call browser_network for current request IDs.')
  })

  it('names a replay Chromium cannot make without a reload', async () => {
    const error = await failure(replayNetworkRequest(inspection([record({ cdpRequestId: undefined })]), 'tab-1', 'request-1'))
    expect(error.key).toBe('appErrors.network.replayNeedsReload')
    expect(error.message).toBe('This XHR cannot be replayed because Chromium did not retain its diagnostic request ID. Close Developer Tools, reload, and capture it again.')
  })

  it('names a Chromium that cannot replay requests', async () => {
    const access = inspection([record()], {
      withDebugger: async () => { throw new Error("'Network.replayXHR' wasn't found") },
      isUnavailableCdpMethod: () => true
    })
    const error = await failure(replayNetworkRequest(access, 'tab-1', 'request-1'))
    expect(error.key).toBe('appErrors.network.replayUnsupported')
    expect(error.message).toBe('XHR replay is unavailable in this Chromium build')
    expect(translate('uk-UA', error.key)).toBe('Ця версія Chromium не може повторювати запити.')
  })
})
