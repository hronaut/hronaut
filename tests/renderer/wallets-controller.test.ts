import { describe, expect, it, vi } from 'vitest'
import { useWalletsController } from '../../src/renderer/src/composables/useWalletsController.js'
import type { HronautWalletsApi, WalletAuditSummary } from '../../src/shared/types.js'
import type { WalletRequestSummary } from '../../src/shared/wallet.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function pendingRequest(): WalletRequestSummary {
  return {
    id: 'request-1',
    walletId: 'wallet-1',
    workspaceId: 'workspace-1',
    status: 'awaiting-human',
    approvalHash: 'a'.repeat(64),
    operation: 'sign-message',
    requester: { type: 'website', id: 'tab-1', name: 'Dapp' },
    origin: 'https://dapp.example',
    networkId: '1',
    createdAt: '2026-08-30T12:00:00.000Z',
    expiresAt: '2026-08-30T12:05:00.000Z'
  }
}

function auditEntry(sequence: number): WalletAuditSummary {
  return {
    sequence,
    timestamp: '2026-08-30T12:00:00.000Z',
    type: 'wallet-request',
    payload: { sequence },
    previousHash: 'a'.repeat(64),
    hash: 'b'.repeat(64)
  }
}

function createController() {
  let requestListener: ((requests: WalletRequestSummary[]) => void) | undefined
  const listRequests = vi.fn(async (): Promise<WalletRequestSummary[]> => [])
  const auditHistory = vi.fn(async (): Promise<WalletAuditSummary[]> => [])
  const api = {
    status: vi.fn(async () => ({
      managedWallets: 'ready', backend: 'safe-storage', watchOnlyAvailable: true
    })),
    list: vi.fn(async () => []),
    listPolicies: vi.fn(async () => []),
    listPermissions: vi.fn(async () => []),
    listRequests,
    auditHistory,
    onChanged: vi.fn(() => () => undefined),
    onStatusChanged: vi.fn(() => () => undefined),
    onRequestsChanged: vi.fn((listener: (requests: WalletRequestSummary[]) => void) => {
      requestListener = listener
      return () => { requestListener = undefined }
    })
  } as unknown as HronautWalletsApi
  const controller = useWalletsController({ api, formatError: String })
  return {
    api,
    auditHistory,
    controller,
    emitRequests: (requests: WalletRequestSummary[]) => requestListener?.(requests),
    listRequests
  }
}

describe('wallets controller', () => {
  it('does not resurrect a request cancelled while a detail refresh is in flight', async () => {
    const delayedAudit = deferred<WalletAuditSummary[]>()
    const request = pendingRequest()
    const { auditHistory, controller, emitRequests, listRequests } = createController()
    await controller.initialize()
    listRequests.mockResolvedValueOnce([request])
    auditHistory.mockReturnValueOnce(delayedAudit.promise)

    const refreshing = controller.refreshDetails()
    emitRequests([])
    delayedAudit.resolve([])
    await refreshing

    expect(controller.requests.value).toEqual([])
    expect(controller.awaitingApproval.value).toEqual([])
    controller.dispose()
  })

  it('keeps the newest result when detail refreshes resolve out of order', async () => {
    const olderAudit = deferred<WalletAuditSummary[]>()
    const newerAudit = deferred<WalletAuditSummary[]>()
    const { auditHistory, controller } = createController()
    await controller.initialize()
    auditHistory
      .mockReturnValueOnce(olderAudit.promise)
      .mockReturnValueOnce(newerAudit.promise)

    const olderRefresh = controller.refreshDetails()
    const newerRefresh = controller.refreshDetails()
    newerAudit.resolve([auditEntry(2)])
    await newerRefresh
    olderAudit.resolve([auditEntry(1)])
    await olderRefresh

    expect(controller.audit.value).toEqual([auditEntry(2)])
    controller.dispose()
  })
})
