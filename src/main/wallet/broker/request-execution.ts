import { createHash } from 'node:crypto'
import type { WalletChainFamily, WalletDescriptor } from '../../../shared/wallet.js'
import { walletAllowsWorkspace } from '../../../shared/wallet.js'
import { signWalletPayload, type WalletMessageSigningInput } from '../accounts.js'
import type { WalletApprovalRecord } from '../approvals.js'
import type { WalletChainAdapter, WalletNormalizedTransaction } from '../adapters/types.js'
import type { WalletBrokerContext } from '../broker.js'
import { reconcileEvmProviderSessions, type EvmProviderAccess } from '../evm-provider.js'
import { restoreWalletJson, walletJsonSafe } from '../json-safe.js'
import type { WalletService } from '../service.js'
import {
  appendTransactionAudit,
  scheduleConfirmation,
  type TransactionConfirmationAccess
} from '../transaction-confirmations.js'

/**
 * What executing an approved request needs from the broker, which keeps the
 * retained message payloads, the page checks and the page connections, so
 * every step before and after signing re-checks that the requesting page,
 * and an agent's session, are still active.
 */
export interface RequestExecutionAccess {
  service: Pick<WalletService, 'approvals' | 'permissions' | 'authorizeSigning' | 'withSecret'>
  adapters: Record<WalletChainFamily, WalletChainAdapter>
  pendingMessages: ReadonlyMap<string, WalletMessageSigningInput>
  assertRecordPageActive(record: WalletApprovalRecord): void
  assertRequestContextActive(context: WalletBrokerContext): void
  requireWallet(walletId: string): WalletDescriptor
  evmProviderAccess(): EvmProviderAccess
  scheduleProviderPermissionExpiry(): void
  clearPendingMessage(requestId: string): void
  transactionConfirmationAccess(): TransactionConfirmationAccess
  now(): Date
}

/**
 * Carries out an approved request: grants account access for a connection,
 * or signs a message or transaction with the wallet's key and, for a send,
 * broadcasts it and tracks its confirmation. A message is signed only if it
 * still matches the approved hash.
 */
export async function execute(
  access: RequestExecutionAccess,
  record: WalletApprovalRecord,
  activeAgentContext?: WalletBrokerContext,
  options: { permissionNotAfter?: string } = {}
): Promise<unknown> {
  access.assertRecordPageActive(record)
  if (activeAgentContext) access.assertRequestContextActive(activeAgentContext)
  if (record.request.operation === 'connect-account') {
    const wallet = access.requireWallet(record.request.walletId)
    if (!walletAllowsWorkspace(wallet, record.request.workspaceId)) {
      throw new Error('Wallet is no longer attached to the requesting workspace')
    }
    if (activeAgentContext) access.assertRequestContextActive(activeAgentContext)
    const permissionScope = {
      walletId: wallet.id, workspaceId: record.request.workspaceId, origin: record.request.topLevelOrigin,
      account: wallet.publicAddress, chainFamily: wallet.chainFamily, networkId: wallet.network.id,
      requester: record.request.requester
    }
    let grantedPermissionId: string | undefined
    let permissionCommitted = false
    try {
      if (!access.service.permissions.allows({ ...permissionScope, capability: 'read' }, access.now())) {
        const permission = await access.service.permissions.grant({
          ...permissionScope,
          capabilities: ['read'],
          // Access granted by a sign-in policy never outlives that policy.
          expiresAt: new Date(Math.min(
            access.now().getTime() + 30 * 24 * 60 * 60_000,
            options.permissionNotAfter ? Date.parse(options.permissionNotAfter) : Number.POSITIVE_INFINITY
          )).toISOString()
        })
        grantedPermissionId = permission.id
      }
      access.assertRecordPageActive(record)
      if (activeAgentContext) access.assertRequestContextActive(activeAgentContext)
      await access.service.approvals.transition(record.id, 'signing', access.now())
      access.assertRecordPageActive(record)
      if (activeAgentContext) access.assertRequestContextActive(activeAgentContext)
      await access.service.approvals.transition(record.id, 'confirmed', access.now())
      permissionCommitted = true
    } catch (error) {
      if (grantedPermissionId && !permissionCommitted) {
        await access.service.permissions.revoke(grantedPermissionId)
      }
      throw error
    }
    if (wallet.chainFamily === 'evm') {
      reconcileEvmProviderSessions(access.evmProviderAccess())
      access.scheduleProviderPermissionExpiry()
    }
    return [wallet.publicAddress]
  }
  const wallet = access.requireWallet(record.request.walletId)
  if (!walletAllowsWorkspace(wallet, record.request.workspaceId)) {
    throw new Error('Wallet is no longer attached to the requesting workspace')
  }
  if (!access.service.permissions.allows({
    walletId: wallet.id,
    workspaceId: record.request.workspaceId,
    origin: record.request.topLevelOrigin,
    account: wallet.publicAddress,
    chainFamily: wallet.chainFamily,
    networkId: wallet.network.id,
    requester: record.request.requester,
    capability: 'read'
  }, access.now())) {
    throw new Error('Wallet account access was revoked before signing')
  }
  if (record.request.operation === 'sign-message') {
    const input = access.pendingMessages.get(record.id)
    if (!input) throw new Error('Wallet message payload is unavailable after restart or cancellation')
    const serialized = JSON.stringify(walletJsonSafe(input))
    const messageHash = createHash('sha256')
      .update('hronaut-wallet-message-v1\u0000')
      .update(serialized)
      .digest('hex')
    if (messageHash !== record.request.payload.messageHash) throw new Error('Approved wallet message has changed')
    const authorization = access.service.authorizeSigning(record.id)
    await access.service.approvals.markSigning(record.id, record.request, access.now())
    access.assertRecordPageActive(record)
    if (activeAgentContext) access.assertRequestContextActive(activeAgentContext)
    try {
      const signature = await access.service.withSecret(wallet.id, authorization, (_descriptor, secret) => (
        signWalletPayload(wallet.chainFamily, secret, input, wallet.publicAddress)
      ))
      access.assertRecordPageActive(record)
      if (activeAgentContext) access.assertRequestContextActive(activeAgentContext)
      await access.service.approvals.transition(record.id, 'confirmed', access.now())
      return signature
    } finally {
      access.clearPendingMessage(record.id)
    }
  }
  const restored = restoreWalletJson(record.request.payload.normalized) as WalletNormalizedTransaction
  const adapter = access.adapters[wallet.chainFamily]
  const authorization = access.service.authorizeSigning(record.id)
  await access.service.approvals.markSigning(record.id, record.request, access.now())
  access.assertRecordPageActive(record)
  if (activeAgentContext) access.assertRequestContextActive(activeAgentContext)
  const signed = await access.service.withSecret(wallet.id, authorization, (descriptor, secret) => adapter.sign(descriptor, secret, restored))
  access.assertRecordPageActive(record)
  if (activeAgentContext) access.assertRequestContextActive(activeAgentContext)
  if (record.request.operation === 'sign-transaction') {
    await access.service.approvals.transition(record.id, 'confirmed', access.now())
    return signed
  }
  const transactionHash = await adapter.broadcast(wallet, signed)
  await access.service.approvals.markSubmitted(record.id, transactionHash, access.now())
  await appendTransactionAudit(access.transactionConfirmationAccess(), 'transaction-submitted', record, transactionHash)
  scheduleConfirmation(access.transactionConfirmationAccess(), record.id)
  return transactionHash
}
