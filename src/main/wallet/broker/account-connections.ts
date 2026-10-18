import type { WalletDescriptor, WalletOperation, WalletPolicy } from '../../../shared/wallet.js'
import type { WalletApprovalRecord } from '../approvals.js'
import type { WalletBrokerContext, WalletBrokerOptions } from '../broker.js'
import type { WalletPolicyDecision } from '../policy.js'
import type { WalletService } from '../service.js'
import type { AccountProviderSession } from '../solana-tron-provider.js'

/**
 * What connecting and disconnecting a page's wallet account needs from the
 * broker, which keeps the connection requests in progress, the permissions
 * and the request path, so a connection is granted only through an approval
 * a person or an opted-in sign-in policy gives.
 */
export interface AccountConnectionsAccess {
  service: Pick<WalletService, 'approvals' | 'audit' | 'permissions'>
  options: Pick<WalletBrokerOptions, 'onProviderEvent'>
  pendingConnections: Map<string, Promise<unknown>>
  hasAddressPermission(context: WalletBrokerContext, wallet: WalletDescriptor): boolean
  requireAccessibleWallet(context: WalletBrokerContext, walletId: string): WalletDescriptor
  createRequest(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    operation: WalletOperation,
    capability: 'read' | 'sign' | 'send',
    payload: Record<string, unknown>
  ): Promise<WalletApprovalRecord>
  wait(requestId: string): Promise<unknown>
  fail(requestId: string, error: unknown): Promise<Error>
  websiteSignInDecision(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    recordId: string
  ): { decision: WalletPolicyDecision; policies: WalletPolicy[] } | undefined
  approveWebsiteSignIn(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    recordId: string,
    policies: readonly WalletPolicy[],
    policyId: string
  ): Promise<{ approved: false } | { approved: true; result: unknown }>
  clearRequestExpiry(requestId: string): void
  clearAccountProviderSessions(predicate: (session: AccountProviderSession) => boolean): void
  queueLifecycle<T>(operation: () => Promise<T>): Promise<T>
  rejectCancelled(): void
  publish(): void
  now(): Date
}

/**
 * Returns the account a page already may see, or asks for account access
 * once per page and wallet, however often the page asks meanwhile.
 */
export async function connect(access: AccountConnectionsAccess, context: WalletBrokerContext, wallet: WalletDescriptor): Promise<unknown> {
  if (access.hasAddressPermission(context, wallet)) return [wallet.publicAddress]
  const key = JSON.stringify([
    wallet.id,
    context.workspaceId,
    context.tabId,
    context.navigationGeneration,
    context.topLevelOrigin,
    context.requester.type,
    context.requester.id
  ])
  const existing = access.pendingConnections.get(key)
  if (existing) return existing
  const connection = (async () => {
    const request = await createAddressPermissionRequest(access, context, wallet, true)
    return request.approved ? request.result : access.wait(request.record.id)
  })()
  access.pendingConnections.set(key, connection)
  try {
    return await connection
  } finally {
    if (access.pendingConnections.get(key) === connection) access.pendingConnections.delete(key)
  }
}

/**
 * Creates a request for a page's access to a wallet account; an opted-in
 * website sign-in policy may approve it, otherwise it waits for a person.
 */
export async function createAddressPermissionRequest(
  access: AccountConnectionsAccess,
  context: WalletBrokerContext,
  wallet: WalletDescriptor,
  allowWebsiteSignIn = false
): Promise<{ record: WalletApprovalRecord; approved: false } | { record: WalletApprovalRecord; approved: true; result: unknown }> {
  const currentWallet = access.requireAccessibleWallet(context, wallet.id)
  const record = await access.createRequest(context, currentWallet, 'connect-account', 'read', { account: currentWallet.publicAddress })
  try {
    await access.service.approvals.transition(record.id, 'validated', access.now())
    await access.service.approvals.recordSimulation(record.id, { attempted: false, success: false }, access.now())
    await access.service.approvals.transition(record.id, 'simulated', access.now())
    await access.service.approvals.transition(record.id, 'policy-decision', access.now())
    const signIn = allowWebsiteSignIn ? access.websiteSignInDecision(context, currentWallet, record.id) : undefined
    if (signIn) {
      await access.service.audit.append('request-simulated', {
        requestId: record.id, walletId: currentWallet.id, success: false, attempted: false,
        policyDecision: signIn.decision.outcome, reason: signIn.decision.reason
      }, access.now().toISOString())
      if (signIn.decision.outcome === 'approved') {
        const automatic = await access.approveWebsiteSignIn(context, currentWallet, record.id, signIn.policies, signIn.decision.policyId)
        if (automatic.approved) {
          access.clearRequestExpiry(record.id)
          access.publish()
          return { record: access.service.approvals.get(record.id)!, approved: true, result: automatic.result }
        }
      }
    }
    await access.service.approvals.transition(record.id, 'awaiting-human', access.now())
    access.publish()
    return { record: access.service.approvals.get(record.id)!, approved: false }
  } catch (error) {
    throw await access.fail(record.id, error)
  }
}

/**
 * Revokes a page's access to a wallet account at the page's request, cancels
 * its open requests on that wallet and tells the page it disconnected.
 */
export function disconnectWallet(access: AccountConnectionsAccess, context: WalletBrokerContext, wallet: WalletDescriptor): Promise<void> {
  return access.queueLifecycle(async () => {
    const permission = access.service.permissions.list().find((entry) => (
      entry.walletId === wallet.id
      && entry.workspaceId === context.workspaceId
      && entry.origin === context.topLevelOrigin
      && entry.account === wallet.publicAddress
      && entry.chainFamily === wallet.chainFamily
      && entry.networkId === wallet.network.id
      && (entry.requester?.type ?? 'website') === context.requester.type
      && (entry.requester?.id ?? entry.origin) === context.requester.id
    ))
    try {
      await access.service.approvals.cancelForPermission({
        walletId: wallet.id,
        workspaceId: context.workspaceId,
        origin: context.topLevelOrigin,
        networkId: wallet.network.id,
        requester: context.requester
      })
      if (permission && await access.service.permissions.revoke(permission.id)) {
        await access.service.audit.append('permission-revoked', {
          permissionId: permission.id,
          walletId: permission.walletId,
          workspaceId: permission.workspaceId,
          origin: permission.origin,
          requester: permission.requester
        }, access.now().toISOString())
      }
      access.clearAccountProviderSessions((session) => (
        session.family === wallet.chainFamily
        && session.walletId === wallet.id
        && session.workspaceId === context.workspaceId
        && session.tabId === context.tabId
        && session.navigationGeneration === context.navigationGeneration
        && session.topLevelOrigin === context.topLevelOrigin
        && session.requester.type === context.requester.type
        && session.requester.id === context.requester.id
      ))
      access.options.onProviderEvent?.(context.tabId, { family: wallet.chainFamily, event: 'disconnect' })
    } finally {
      access.rejectCancelled()
    }
  })
}
