import type { WalletDescriptor, WalletPolicy, WalletUpdateInput } from '../../../shared/wallet.js'
import { WalletUpdateInputSchema } from '../../../shared/wallet.js'
import type { WalletService } from '../service.js'

/**
 * What wallet management needs from the broker, which keeps the lifecycle
 * queue and the page connections, so a change a person makes in the wallet
 * settings waits for running wallet work, and pages lose the accounts and
 * requests the change took away.
 */
export interface WalletManagementAccess {
  service: Pick<WalletService, 'update' | 'setPolicy' | 'removePolicy' | 'remove' | 'permissions' | 'approvals' | 'audit'>
  queueLifecycle<T>(operation: () => Promise<T>): Promise<T>
  reconcileProviderSessions(): void
  rejectCancelled(): void
  now(): Date
}

/** Applies a validated change to a wallet's name, workspaces or RPC endpoint, then updates page connections and settles cancelled requests. */
export function updateWallet(access: WalletManagementAccess, walletId: string, changes: WalletUpdateInput): Promise<WalletDescriptor> {
  return access.queueLifecycle(async () => {
    const validated = WalletUpdateInputSchema.parse(changes)
    try {
      return await access.service.update(walletId, validated)
    } finally {
      access.reconcileProviderSessions()
      access.rejectCancelled()
    }
  })
}

/** Saves a wallet policy. */
export function setPolicy(access: WalletManagementAccess, input: WalletPolicy): Promise<WalletPolicy> {
  return access.queueLifecycle(() => access.service.setPolicy(input))
}

/** Removes a wallet policy. */
export function removePolicy(access: WalletManagementAccess, policyId: string): Promise<boolean> {
  return access.queueLifecycle(() => access.service.removePolicy(policyId))
}

/** Removes a wallet, then updates page connections and settles cancelled requests. */
export function removeWallet(access: WalletManagementAccess, walletId: string): Promise<boolean> {
  return access.queueLifecycle(async () => {
    try {
      return await access.service.remove(walletId)
    } finally {
      access.reconcileProviderSessions()
      access.rejectCancelled()
    }
  })
}

/** Revokes a page's or agent's account access and cancels the requests that relied on it. */
export function revokePermission(access: WalletManagementAccess, permissionId: string): Promise<boolean> {
  return access.queueLifecycle(async () => {
    const permission = access.service.permissions.get(permissionId)
    if (!permission) return false
    try {
      await access.service.approvals.cancelForPermission(permission)
      const revoked = await access.service.permissions.revoke(permissionId)
      if (revoked) {
        await access.service.audit.append('permission-revoked', {
          permissionId,
          walletId: permission.walletId,
          workspaceId: permission.workspaceId,
          origin: permission.origin,
          requester: permission.requester
        }, access.now().toISOString())
      }
      return revoked
    } finally {
      if (!access.service.permissions.get(permissionId)) access.reconcileProviderSessions()
      access.rejectCancelled()
    }
  })
}
