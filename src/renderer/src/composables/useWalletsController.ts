import { computed, ref } from 'vue'
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
  const subscriptions: Array<() => void> = []

  const awaitingApproval = computed(() => requests.value.filter((request) => request.status === 'awaiting-human'))

  function setError(error: unknown): void {
    errorMessage.value = options.formatError(error)
  }

  async function refreshDetails(): Promise<void> {
    const [nextPolicies, nextPermissions, nextRequests, nextAudit] = await Promise.all([
      options.api.listPolicies(), options.api.listPermissions(), options.api.listRequests(), options.api.auditHistory()
    ])
    if (disposed) return
    policies.value = nextPolicies
    permissions.value = nextPermissions
    requests.value = nextRequests
    audit.value = nextAudit
  }

  async function initialize(): Promise<void> {
    const [nextStatus, nextWallets] = await Promise.all([options.api.status(), options.api.list()])
    if (disposed) return
    status.value = nextStatus
    wallets.value = nextWallets
    await refreshDetails()
    if (initialized || disposed) return
    initialized = true
    subscriptions.push(
      options.api.onChanged((next) => { wallets.value = next }),
      options.api.onStatusChanged((next) => { status.value = next }),
      options.api.onRequestsChanged((next) => { requests.value = next })
    )
  }

  async function run<T>(operation: () => Promise<T>, refresh = true): Promise<T | undefined> {
    if (busy.value) return undefined
    busy.value = true
    errorMessage.value = ''
    try {
      const result = await operation()
      if (refresh && !disposed) {
        status.value = await options.api.status()
        wallets.value = await options.api.list()
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
    subscriptions.splice(0).forEach((unsubscribe) => unsubscribe())
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
