import { describe, expect, it, vi } from 'vitest'
import { useWalletsController } from '../../src/renderer/src/composables/useWalletsController.js'
import type { HronautWalletsApi, WalletAuditSummary } from '../../src/shared/types.js'
import type {
  WalletDescriptor,
  WalletRequestSummary,
  WalletServiceStatus
} from '../../src/shared/wallet.js'

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

function wallet(id: string): WalletDescriptor {
  return {
    id,
    name: id,
    kind: 'watch-only',
    chainFamily: 'evm',
    publicAddress: '0x0000000000000000000000000000000000000001',
    network: {
      id: '1', name: 'Ethereum', environment: 'mainnet', rpcUrl: 'https://rpc.example'
    },
    capabilities: ['read'],
    workspaceIds: ['workspace-1'],
    policyIds: [],
    recoveryConfirmed: true,
    createdAt: '2026-08-30T12:00:00.000Z',
    updatedAt: '2026-08-30T12:00:00.000Z'
  }
}

const readyStatus: WalletServiceStatus = {
  managedWallets: 'ready', backend: 'safe-storage', watchOnlyAvailable: true
}

interface SubscriptionHooks {
  requests?: (listener: (requests: WalletRequestSummary[]) => void) => void
  status?: (listener: (status: WalletServiceStatus) => void) => void
  wallets?: (listener: (wallets: WalletDescriptor[]) => void) => void
}

function createController(onSubscribe: SubscriptionHooks = {}) {
  let statusListener: ((status: WalletServiceStatus) => void) | undefined
  let walletListener: ((wallets: WalletDescriptor[]) => void) | undefined
  let requestListener: ((requests: WalletRequestSummary[]) => void) | undefined
  const status = vi.fn(async (): Promise<WalletServiceStatus> => readyStatus)
  const list = vi.fn(async (): Promise<WalletDescriptor[]> => [])
  const listPolicies = vi.fn(async () => [])
  const listRequests = vi.fn(async (): Promise<WalletRequestSummary[]> => [])
  const auditHistory = vi.fn(async (): Promise<WalletAuditSummary[]> => [])
  const cancelImport = vi.fn(async () => true)
  const walletUnsubscribe = vi.fn(() => { walletListener = undefined })
  const statusUnsubscribe = vi.fn(() => { statusListener = undefined })
  const requestUnsubscribe = vi.fn(() => { requestListener = undefined })
  const api = {
    status,
    list,
    lock: vi.fn(async (): Promise<WalletServiceStatus> => ({
      managedWallets: 'locked', backend: 'safe-storage', watchOnlyAvailable: true
    })),
    listPolicies,
    listPermissions: vi.fn(async () => []),
    listRequests,
    auditHistory,
    cancelImport,
    onChanged: vi.fn((listener: (wallets: WalletDescriptor[]) => void) => {
      walletListener = listener
      onSubscribe.wallets?.(listener)
      return walletUnsubscribe
    }),
    onStatusChanged: vi.fn((listener: (status: WalletServiceStatus) => void) => {
      statusListener = listener
      onSubscribe.status?.(listener)
      return statusUnsubscribe
    }),
    onRequestsChanged: vi.fn((listener: (requests: WalletRequestSummary[]) => void) => {
      requestListener = listener
      onSubscribe.requests?.(listener)
      return requestUnsubscribe
    })
  } as unknown as HronautWalletsApi
  const controller = useWalletsController({ api, formatError: String })
  return {
    api,
    auditHistory,
    cancelImport,
    controller,
    emitRequests: (requests: WalletRequestSummary[]) => requestListener?.(requests),
    emitStatus: (next: WalletServiceStatus) => statusListener?.(next),
    emitWallets: (next: WalletDescriptor[]) => walletListener?.(next),
    list,
    listPolicies,
    listRequests,
    requestUnsubscribe,
    statusUnsubscribe,
    walletUnsubscribe,
    status
  }
}

describe('wallets controller', () => {
  it('cleans every listener and preserves startup errors when initialization fails', async () => {
    const sourceError = new Error('wallet policy snapshot unavailable')
    const cleanupError = new Error('wallet listener already closed')
    const {
      controller,
      listPolicies,
      requestUnsubscribe,
      statusUnsubscribe,
      walletUnsubscribe
    } = createController()
    listPolicies.mockRejectedValueOnce(sourceError)
    walletUnsubscribe.mockImplementationOnce(() => { throw cleanupError })

    const failure = await controller.initialize().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([sourceError, cleanupError])
    expect(walletUnsubscribe).toHaveBeenCalledOnce()
    expect(statusUnsubscribe).toHaveBeenCalledOnce()
    expect(requestUnsubscribe).toHaveBeenCalledOnce()
    await expect(controller.initialize()).resolves.toBeUndefined()
    controller.dispose()
  })

  it('preserves authoritative events delivered while startup listeners are attached', async () => {
    const newestWallet = wallet('synchronous-startup-wallet')
    const lockedStatus: WalletServiceStatus = {
      managedWallets: 'locked', backend: 'safe-storage', watchOnlyAvailable: true
    }
    const { controller, list, listRequests, status } = createController({
      requests: (listener) => listener([]),
      status: (listener) => listener(lockedStatus),
      wallets: (listener) => listener([newestWallet])
    })
    status.mockResolvedValueOnce(readyStatus)
    list.mockResolvedValueOnce([wallet('stale-synchronous-wallet')])
    listRequests.mockResolvedValueOnce([pendingRequest()])

    await controller.initialize()

    expect(controller.status.value).toEqual(lockedStatus)
    expect(controller.wallets.value).toEqual([newestWallet])
    expect(controller.requests.value).toEqual([])
    controller.dispose()
  })

  it('preserves live status and wallet events delivered during initialization', async () => {
    const delayedStatus = deferred<WalletServiceStatus>()
    const delayedWallets = deferred<WalletDescriptor[]>()
    const newestWallet = wallet('startup-event-wallet')
    const { controller, emitStatus, emitWallets, list, status } = createController()
    status.mockReturnValueOnce(delayedStatus.promise)
    list.mockReturnValueOnce(delayedWallets.promise)

    const initializing = controller.initialize()
    await vi.waitFor(() => {
      expect(status).toHaveBeenCalledOnce()
      expect(list).toHaveBeenCalledOnce()
    })
    emitStatus({ managedWallets: 'locked', backend: 'safe-storage', watchOnlyAvailable: true })
    emitWallets([newestWallet])
    delayedStatus.resolve(readyStatus)
    delayedWallets.resolve([wallet('stale-startup-wallet')])
    await initializing

    expect(controller.status.value.managedWallets).toBe('locked')
    expect(controller.wallets.value).toEqual([newestWallet])
    controller.dispose()
  })

  it('preserves a live request event delivered during initialization', async () => {
    const delayedAudit = deferred<WalletAuditSummary[]>()
    const { auditHistory, controller, emitRequests, listRequests } = createController()
    listRequests.mockResolvedValueOnce([pendingRequest()])
    auditHistory.mockReturnValueOnce(delayedAudit.promise)

    const initializing = controller.initialize()
    await vi.waitFor(() => expect(auditHistory).toHaveBeenCalledOnce())
    emitRequests([])
    delayedAudit.resolve([])
    await initializing

    expect(controller.requests.value).toEqual([])
    expect(controller.awaitingApproval.value).toEqual([])
    controller.dispose()
  })

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

  it('does not overwrite a live status event with an older post-operation snapshot', async () => {
    const delayedStatus = deferred<WalletServiceStatus>()
    const { controller, emitStatus, status } = createController()
    await controller.initialize()
    status.mockReturnValueOnce(delayedStatus.promise)

    const locking = controller.lock()
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2))
    emitStatus({ managedWallets: 'locked', backend: 'safe-storage', watchOnlyAvailable: true })
    delayedStatus.resolve(readyStatus)
    await locking

    expect(controller.status.value.managedWallets).toBe('locked')
    controller.dispose()
  })

  it('does not overwrite a live wallet event with an older post-operation snapshot', async () => {
    const delayedWallets = deferred<WalletDescriptor[]>()
    const newestWallet = wallet('newest-wallet')
    const { controller, emitWallets, list } = createController()
    await controller.initialize()
    list.mockReturnValueOnce(delayedWallets.promise)

    const locking = controller.lock()
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    emitWallets([newestWallet])
    delayedWallets.resolve([wallet('stale-wallet')])
    await locking

    expect(controller.wallets.value).toEqual([newestWallet])
    controller.dispose()
  })

  it('stops a post-operation refresh when the controller is disposed', async () => {
    const delayedStatus = deferred<WalletServiceStatus>()
    const { controller, list, status } = createController()
    await controller.initialize()
    status.mockReturnValueOnce(delayedStatus.promise)

    const locking = controller.lock()
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2))
    controller.dispose()
    delayedStatus.resolve({
      managedWallets: 'locked', backend: 'safe-storage', watchOnlyAvailable: true
    })
    await locking

    expect(controller.status.value).toEqual(readyStatus)
    expect(list).toHaveBeenCalledOnce()
  })

  it('cancels pending imports while another wallet operation is refreshing', async () => {
    const delayedStatus = deferred<WalletServiceStatus>()
    const { cancelImport, controller, status } = createController()
    await controller.initialize()
    status.mockReturnValueOnce(delayedStatus.promise)

    const locking = controller.lock()
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2))

    await expect(controller.cancelImport('pending-import-token')).resolves.toBe(true)
    expect(cancelImport).toHaveBeenCalledOnce()
    expect(cancelImport).toHaveBeenCalledWith('pending-import-token')

    delayedStatus.resolve(readyStatus)
    await locking
    controller.dispose()
  })
})
