import { computed, ref } from 'vue'
import { disposeAll, registerDisposers } from './dispose-all.js'
import type {
  HronautWalletsApi,
  WalletAuditSummary,
  WalletPermissionSummary,
  WalletPreparedImport
} from '../../../shared/types.js'
import type {
  WalletCreateInput,
  WalletDescriptor,
  WalletImportDetails,
  WalletPolicy,
  WalletRequestSummary,
  WalletSecretFormat,
  WalletServiceStatus,
  WalletUpdateInput,
  WalletWatchOnlyInput
} from '../../../shared/wallet.js'

export interface WalletsControllerOptions {
  api: HronautWalletsApi
  formatError: (error: unknown) => string
}

export function useWalletsController(options: WalletsControllerOptions) {
  const status = ref<WalletServiceStatus>({
    managedWallets: 'disabled', backend: 'initializing', watchOnlyAvailable: false, reason: 'Wallet service is initializing.'
  })
  const wallets = ref<WalletDescriptor[]>([])
  const policies = ref<WalletPolicy[]>([])
  const permissions = ref<WalletPermissionSummary[]>([])
  const requests = ref<WalletRequestSummary[]>([])
  const audit = ref<WalletAuditSummary[]>([])
  const busy = ref(false)
  const errorMessage = ref('')
  let disposed = false
  let initialized = false
  let initializePromise: Promise<void> | null = null
  let detailsGeneration = 0
  let statusRevision = 0
  let walletsRevision = 0
  let requestsRevision = 0
  const subscriptions: Array<() => void> = []

  const awaitingApproval = computed(() => requests.value.filter((request) => request.status === 'awaiting-human'))

  function setError(error: unknown): void {
    errorMessage.value = options.formatError(error)
  }

  function acceptStatus(next: WalletServiceStatus): void {
    statusRevision += 1
    status.value = next
  }

  function acceptWallets(next: WalletDescriptor[]): void {
    walletsRevision += 1
    wallets.value = next
  }

  function detachSubscriptions(): void {
    disposeAll(subscriptions.splice(0))
  }

  function attachSubscriptions(): void {
    if (initialized || disposed) return
    subscriptions.push(...registerDisposers([
      () => options.api.onChanged((next) => {
        if (!disposed) acceptWallets(next)
      }),
      () => options.api.onStatusChanged((next) => {
        if (!disposed) acceptStatus(next)
      }),
      () => options.api.onRequestsChanged((next) => {
        if (disposed) return
        requestsRevision += 1
        requests.value = next
      })
    ]))
    initialized = true
  }

  async function loadDetails(startingRequestsRevision: number): Promise<void> {
    const currentGeneration = ++detailsGeneration
    const [nextPolicies, nextPermissions, nextRequests, nextAudit] = await Promise.all([
      options.api.listPolicies(), options.api.listPermissions(), options.api.listRequests(), options.api.auditHistory()
    ])
    if (disposed || currentGeneration !== detailsGeneration) return
    policies.value = nextPolicies
    permissions.value = nextPermissions
    if (startingRequestsRevision === requestsRevision) requests.value = nextRequests
    audit.value = nextAudit
  }

  function refreshDetails(): Promise<void> {
    return loadDetails(requestsRevision)
  }

  function initialize(): Promise<void> {
    if (initializePromise) return initializePromise
    if (disposed) return Promise.resolve()
    const startingStatusRevision = statusRevision
    const startingWalletsRevision = walletsRevision
    const startingRequestsRevision = requestsRevision
    try {
      attachSubscriptions()
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    const operation = (async () => {
      try {
        const [nextStatus, nextWallets] = await Promise.all([options.api.status(), options.api.list()])
        if (disposed) return
        if (startingStatusRevision === statusRevision) acceptStatus(nextStatus)
        if (startingWalletsRevision === walletsRevision) acceptWallets(nextWallets)
        await loadDetails(startingRequestsRevision)
      } catch (error) {
        const failures = [error]
        if (!disposed) {
          initialized = false
          try {
            detachSubscriptions()
          } catch (cleanupError) {
            if (cleanupError instanceof AggregateError) {
              failures.push(...(cleanupError.errors as unknown[]))
            } else {
              failures.push(cleanupError)
            }
          }
        }
        if (failures.length === 1) throw error
        throw new AggregateError(failures, 'Wallet initialization failed and listener cleanup was incomplete')
      }
    })()
    const trackedOperation = operation.finally(() => {
      if (initializePromise === trackedOperation) initializePromise = null
    })
    initializePromise = trackedOperation
    return trackedOperation
  }

  async function run<T>(operation: () => Promise<T>, refresh = true): Promise<T | undefined> {
    if (busy.value) return undefined
    busy.value = true
    errorMessage.value = ''
    try {
      const result = await operation()
      if (refresh && !disposed) {
        const startingStatusRevision = statusRevision
        const nextStatus = await options.api.status()
        if (disposed) return result
        if (startingStatusRevision === statusRevision) acceptStatus(nextStatus)
        const startingWalletsRevision = walletsRevision
        const nextWallets = await options.api.list()
        if (disposed) return result
        if (startingWalletsRevision === walletsRevision) acceptWallets(nextWallets)
        await refreshDetails()
      }
      return result
    } catch (error) {
      if (!disposed) setError(error)
      return undefined
    } finally {
      if (!disposed) busy.value = false
    }
  }

  const setupPassphrase = (passphrase: string) => run(() => options.api.setupPassphrase(passphrase))
  const unlock = (passphrase: string) => run(() => options.api.unlock(passphrase))
  const lock = () => run(() => options.api.lock())
  const generate = (input: WalletCreateInput) => run(() => options.api.generate(input))
  const prepareImport = (
    chainFamily: WalletDescriptor['chainFamily'],
    format: WalletSecretFormat,
    recoveryMaterial: string
  ): Promise<WalletPreparedImport | undefined> => run(
    () => options.api.prepareImport(chainFamily, format, recoveryMaterial),
    false
  )
  const confirmImport = (token: string, details: WalletImportDetails) => run(() => options.api.confirmImport(token, details))
  const cancelImport = (token: string) => run(() => options.api.cancelImport(token), false)
  const addWatchOnly = (input: WalletWatchOnlyInput) => run(() => options.api.addWatchOnly(input))
  const update = (walletId: string, changes: WalletUpdateInput) => run(() => options.api.update(walletId, changes))
  const remove = (walletId: string) => run(() => options.api.remove(walletId))
  const setPolicy = (policy: WalletPolicy) => run(() => options.api.setPolicy(policy))
  const removePolicy = (policyId: string) => run(() => options.api.removePolicy(policyId))
  const revokePermission = (permissionId: string) => run(() => options.api.revokePermission(permissionId))
  const approve = (requestId: string) => run(() => options.api.approveRequest(requestId))
  const reject = (requestId: string) => run(() => options.api.rejectRequest(requestId))

  function dispose(): void {
    disposed = true
    detailsGeneration += 1
    detachSubscriptions()
  }

  return {
    status,
    wallets,
    policies,
    permissions,
    requests,
    audit,
    awaitingApproval,
    busy,
    errorMessage,
    initialize,
    refreshDetails,
    setupPassphrase,
    unlock,
    lock,
    generate,
    prepareImport,
    confirmImport,
    cancelImport,
    addWatchOnly,
    update,
    remove,
    setPolicy,
    removePolicy,
    revokePermission,
    approve,
    reject,
    dispose
  }
}

export type WalletsController = ReturnType<typeof useWalletsController>
