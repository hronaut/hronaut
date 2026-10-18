import { isDeepStrictEqual } from 'node:util'
import type { WalletDescriptor, WalletPolicy } from '../../../shared/wallet.js'
import type { WalletApprovalRecord } from '../approvals.js'
import type { WalletBrokerContext } from '../broker.js'
import {
  websiteSignInPolicyApplies,
  websiteTypedDataPolicyApplies,
  type WalletPolicyDecision,
  type WalletPolicyEngine,
  type WalletWebsiteSignInEvaluation
} from '../policy.js'
import type { WalletService } from '../service.js'

/**
 * What website sign-in policies need from the broker, which keeps the
 * policy engine, the lifecycle queue and the request path, so a request a
 * sign-in policy approves is still re-checked in that queue and executed
 * through the broker's own page checks.
 */
export interface WebsiteSignInAccess {
  service: Pick<WalletService, 'approvals' | 'audit' | 'policies' | 'policyUsage'>
  policy: WalletPolicyEngine
  assertRequestContextActive(context: WalletBrokerContext): void
  requireAccessibleWallet(context: WalletBrokerContext, walletId: string): WalletDescriptor
  execute(record: WalletApprovalRecord, activeAgentContext: WalletBrokerContext, options: { permissionNotAfter?: string }): Promise<unknown>
  queueLifecycle<T>(operation: () => Promise<T>): Promise<T>
  now(): Date
}

/**
 * Evaluates a website's connection or message request against the wallet's
 * opted-in sign-in policies. Returns undefined when no attached policy allows
 * website sign-in, so requests on other wallets keep their existing path.
 */
export function websiteSignInDecision(
  access: WebsiteSignInAccess,
  context: WalletBrokerContext,
  wallet: WalletDescriptor,
  recordId: string,
  message?: WalletWebsiteSignInEvaluation['message']
): { decision: WalletPolicyDecision; policies: WalletPolicy[] } | undefined {
  if (context.requester.type !== 'website') return undefined
  const policies = access.service.policies.list(wallet.id)
    .filter((policy) => wallet.policyIds.includes(policy.id) && policy.allowWebsiteSignIn === true)
  if (!policies.length) return undefined
  const now = access.now()
  const usageByPolicy = Object.fromEntries(policies.map((policy) => [
    policy.id,
    { operationCount: access.service.policyUsage.snapshot(policy.id, now).operationCount }
  ]))
  const decision = access.policy.evaluateWebsiteSignIn({
    request: access.service.approvals.get(recordId)!.request,
    wallet,
    policies,
    now,
    usageByPolicy,
    ...(message ? { message } : {})
  })
  return { decision, policies }
}

/**
 * Reserves one operation on the matching sign-in policy, re-checks the
 * policy and wallet inside the lifecycle queue, including the typed-data
 * switch for typed data, then approves and executes the request as the
 * policy. Anything that changed returns it to a person.
 */
export async function approveWebsiteSignIn(
  access: WebsiteSignInAccess,
  context: WalletBrokerContext,
  wallet: WalletDescriptor,
  recordId: string,
  policies: readonly WalletPolicy[],
  policyId: string,
  typedData = false
): Promise<{ approved: false } | { approved: true; result: unknown }> {
  access.assertRequestContextActive(context)
  const policy = policies.find((entry) => entry.id === policyId)
  if (!policy) throw new Error('Wallet automatic policy is unavailable')
  const reservation = await access.service.policyUsage.reserve(policy, '0', access.now())
  if (!reservation.reserved) {
    await access.service.audit.append('policy-reservation-denied', {
      requestId: recordId, walletId: wallet.id, policyId: policy.id, reason: reservation.reason
    }, access.now().toISOString())
    return { approved: false }
  }
  await access.service.audit.append('policy-reservation-created', {
    requestId: recordId, walletId: wallet.id, policyId: policy.id,
    operationCount: reservation.snapshot.operationCount
  }, access.now().toISOString())
  return access.queueLifecycle(async () => {
    access.assertRequestContextActive(context)
    const currentWallet = access.requireAccessibleWallet(context, wallet.id)
    const currentPolicy = access.service.policies.list(wallet.id).find((entry) => entry.id === policy.id)
    const current = access.service.approvals.get(recordId)!
    const authorizationNow = access.now()
    if (
      !currentPolicy
      || !currentWallet.policyIds.includes(policy.id)
      || !isDeepStrictEqual(currentPolicy, policy)
      || currentWallet.network.id !== current.request.networkId
      || !websiteSignInPolicyApplies(currentWallet, currentPolicy, authorizationNow)
      || (typedData && !websiteTypedDataPolicyApplies(currentWallet, currentPolicy, authorizationNow))
    ) {
      await access.service.audit.append('policy-authorization-invalidated', {
        requestId: recordId, walletId: wallet.id, policyId: policy.id
      }, access.now().toISOString())
      return { approved: false }
    }
    await access.service.approvals.approve(recordId, current.request, authorizationNow)
    await access.service.audit.append('request-approved-by-policy', {
      requestId: recordId, walletId: wallet.id, policyId: policy.id,
      operation: current.request.operation, requester: current.request.requester, origin: current.request.topLevelOrigin
    }, access.now().toISOString())
    access.assertRequestContextActive(context)
    const result = await access.execute(access.service.approvals.get(recordId)!, context, { permissionNotAfter: currentPolicy.expiresAt })
    return { approved: true, result }
  })
}
