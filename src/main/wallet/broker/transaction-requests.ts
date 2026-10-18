import { isDeepStrictEqual } from 'node:util'
import type { WalletChainFamily, WalletDescriptor, WalletOperation } from '../../../shared/wallet.js'
import type { WalletApprovalRecord } from '../approvals.js'
import type { WalletChainAdapter, WalletNormalizedTransaction } from '../adapters/types.js'
import type { WalletBrokerContext } from '../broker.js'
import { walletJsonSafe } from '../json-safe.js'
import { isMainnetAgentAutomationPolicy, type WalletPolicyEngine } from '../policy.js'
import { agentSummary, sanitizedSimulation } from '../request-summary.js'
import type { WalletService } from '../service.js'

/**
 * What a transaction request needs from the broker, which keeps the policy
 * engine, the lifecycle queue and the request path, so a transaction an
 * agent policy approves is re-checked in that queue, and any other waits
 * for a person.
 */
export interface TransactionRequestsAccess {
  service: Pick<WalletService, 'approvals' | 'audit' | 'policies' | 'policyUsage'>
  adapters: Record<WalletChainFamily, WalletChainAdapter>
  policy: WalletPolicyEngine
  assertRequestContextActive(context: WalletBrokerContext): void
  requireAccessibleWallet(context: WalletBrokerContext, walletId: string): WalletDescriptor
  requireWallet(walletId: string): WalletDescriptor
  assertAddressPermission(context: WalletBrokerContext, wallet: WalletDescriptor, capability: 'sign' | 'send'): void
  createRequest(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    operation: WalletOperation,
    capability: 'read' | 'sign' | 'send',
    payload: Record<string, unknown>
  ): Promise<WalletApprovalRecord>
  execute(record: WalletApprovalRecord, activeAgentContext: WalletBrokerContext): Promise<unknown>
  wait(requestId: string): Promise<unknown>
  fail(requestId: string, error: unknown): Promise<Error>
  clearRequestExpiry(requestId: string): void
  queueLifecycle<T>(operation: () => Promise<T>): Promise<T>
  publish(): void
  now(): Date
}

/**
 * Asks to sign, or sign and send, a transaction from a page or agent: it is
 * normalized and simulated, then checked against the wallet's policies. A
 * policy rejection fails it; a policy approval reserves the policy's budget
 * and signs once the policy and wallet are re-checked in the lifecycle
 * queue; anything else waits for a person. With returnSummary the agent gets
 * the request's summary instead of waiting.
 */
export async function transactionRequest(
  access: TransactionRequestsAccess,
  context: WalletBrokerContext,
  wallet: WalletDescriptor,
  payload: unknown,
  broadcast: boolean,
  returnSummary = false,
  prepared?: WalletNormalizedTransaction
): Promise<unknown> {
  const adapter = access.adapters[wallet.chainFamily]
  const normalized = prepared ?? await adapter.normalizeTransaction(wallet, payload)
  access.assertRequestContextActive(context)
  const operation: WalletOperation = broadcast ? 'sign-and-send-transaction' : 'sign-transaction'
  const currentWallet = access.requireAccessibleWallet(context, wallet.id)
  access.assertAddressPermission(context, currentWallet, broadcast ? 'send' : 'sign')
  const record = await access.createRequest(context, currentWallet, operation, broadcast ? 'send' : 'sign', {
    normalized: walletJsonSafe(normalized)
  })
  // A policy rejection ends the request as rejected, which would otherwise read as the person's rejection.
  let policyRejection: Error | undefined
  try {
    await access.service.approvals.transition(record.id, 'validated', access.now())
    const simulation = sanitizedSimulation(await adapter.simulate(wallet, normalized))
    access.assertRequestContextActive(context)
    await access.service.approvals.recordSimulation(record.id, simulation, access.now())
    await access.service.approvals.transition(record.id, 'simulated', access.now())
    await access.service.approvals.transition(record.id, 'policy-decision', access.now())
    const policies = access.service.policies.list(wallet.id)
      .filter((policy) => wallet.policyIds.includes(policy.id))
    const policyUsage = new Map(policies.map((policy) => [
      policy.id,
      access.service.policyUsage.snapshot(policy.id, access.now())
    ]))
    const usageByPolicy = Object.fromEntries([...policyUsage].map(([policyId, usage]) => [policyId, {
      sessionSpend: usage.sessionSpend,
      dailySpend: usage.dailySpend,
      operationCount: usage.operationCount
    }]))
    const decision = access.policy.evaluate({
      request: access.service.approvals.get(record.id)!.request,
      wallet,
      policies,
      decoded: normalized.decoded,
      simulation,
      now: access.now(),
      sessionSpend: '0', dailySpend: '0', operationCount: 0, usageByPolicy
    })
    await access.service.audit.append('request-simulated', {
      requestId: record.id, walletId: wallet.id, success: simulation.success, attempted: simulation.attempted,
      policyDecision: decision.outcome, reason: decision.reason
    }, access.now().toISOString())
    if (decision.outcome === 'rejected') {
      await access.service.approvals.transition(record.id, 'rejected', access.now())
      access.clearRequestExpiry(record.id)
      policyRejection = new Error(`Wallet policy rejected the request: ${decision.reason}`)
      throw policyRejection
    }
    if (decision.outcome === 'approved') {
      access.assertRequestContextActive(context)
      const policy = policies.find((entry) => entry.id === decision.policyId)
      if (!policy) throw new Error('Wallet automatic policy is unavailable')
      const reservation = await access.service.policyUsage.reserve(policy, normalized.decoded.nativeAmount, access.now())
      if (!reservation.reserved) {
        await access.service.audit.append('policy-reservation-denied', {
          requestId: record.id, walletId: wallet.id, policyId: policy.id, reason: reservation.reason
        }, access.now().toISOString())
        await access.service.approvals.transition(record.id, 'awaiting-human', access.now())
        if (returnSummary) access.publish()
        return returnSummary
          ? agentSummary(access.service.approvals.get(record.id)!, wallet)
          : access.wait(record.id)
      }
      await access.service.audit.append('policy-reservation-created', {
        requestId: record.id, walletId: wallet.id, policyId: policy.id,
        operationCount: reservation.snapshot.operationCount,
        sessionSpend: reservation.snapshot.sessionSpend,
        dailySpend: reservation.snapshot.dailySpend
      }, access.now().toISOString())
      let policyInvalidated = false
      const result = await access.queueLifecycle(async () => {
        access.assertRequestContextActive(context)
        const currentWallet = access.requireAccessibleWallet(context, wallet.id)
        const currentPolicy = access.service.policies.list(wallet.id)
          .find((entry) => entry.id === policy.id)
        const authorizationNow = access.now()
        if (
          !currentPolicy
          || !currentWallet.policyIds.includes(policy.id)
          || !isDeepStrictEqual(currentPolicy, policy)
          || Date.parse(currentPolicy.expiresAt) <= authorizationNow.getTime()
          || (
            currentWallet.network.environment === 'mainnet'
            && !isMainnetAgentAutomationPolicy(currentPolicy, authorizationNow)
          )
        ) {
          policyInvalidated = true
          await access.service.audit.append('policy-authorization-invalidated', {
            requestId: record.id, walletId: wallet.id, policyId: policy.id
          }, access.now().toISOString())
          await access.service.approvals.transition(record.id, 'awaiting-human', access.now())
          return undefined
        }
        const current = access.service.approvals.get(record.id)!
        await access.service.approvals.approve(record.id, current.request, access.now())
        access.assertRequestContextActive(context)
        return access.execute(access.service.approvals.get(record.id)!, context)
      })
      if (policyInvalidated) {
        const current = access.service.approvals.get(record.id)!
        if (returnSummary) access.publish()
        return returnSummary ? agentSummary(current, access.requireWallet(wallet.id)) : access.wait(record.id)
      }
      access.clearRequestExpiry(record.id)
      return returnSummary ? agentSummary(access.service.approvals.get(record.id)!, wallet) : result
    }
    await access.service.approvals.transition(record.id, 'awaiting-human', access.now())
    if (returnSummary) access.publish()
    return returnSummary
      ? agentSummary(access.service.approvals.get(record.id)!, wallet)
      : access.wait(record.id)
  } catch (error) {
    const failure = await access.fail(record.id, error)
    throw policyRejection !== undefined && error === policyRejection ? policyRejection : failure
  }
}
