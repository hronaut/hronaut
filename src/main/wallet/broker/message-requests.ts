import { createHash } from 'node:crypto'
import type { WalletDescriptor, WalletOperation, WalletPolicy } from '../../../shared/wallet.js'
import type { WalletMessageSigningInput } from '../accounts.js'
import type { WalletApprovalRecord } from '../approvals.js'
import type { WalletBrokerContext } from '../broker.js'
import { walletJsonSafe } from '../json-safe.js'
import type { WalletPolicyDecision, WalletWebsiteSignInEvaluation } from '../policy.js'
import { agentSummary } from '../request-summary.js'
import type { WalletService } from '../service.js'

/**
 * What a message signing request needs from the broker, which keeps the
 * retained message payloads and the request path, so the bytes a person or
 * sign-in policy approves are the bytes that get signed.
 */
export interface MessageRequestsAccess {
  service: Pick<WalletService, 'approvals' | 'audit'>
  pendingMessages: Map<string, WalletMessageSigningInput>
  requireAccessibleWallet(context: WalletBrokerContext, walletId: string): WalletDescriptor
  assertAddressPermission(context: WalletBrokerContext, wallet: WalletDescriptor, capability: 'sign' | 'send'): void
  createRequest(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    operation: WalletOperation,
    capability: 'read' | 'sign' | 'send',
    payload: Record<string, unknown>
  ): Promise<WalletApprovalRecord>
  websiteSignInDecision(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    recordId: string,
    message: WalletWebsiteSignInEvaluation['message']
  ): { decision: WalletPolicyDecision; policies: WalletPolicy[] } | undefined
  approveWebsiteSignIn(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    recordId: string,
    policies: readonly WalletPolicy[],
    policyId: string,
    typedData: boolean
  ): Promise<{ approved: false } | { approved: true; result: unknown }>
  clearRequestExpiry(requestId: string): void
  wait(requestId: string): Promise<unknown>
  fail(requestId: string, error: unknown): Promise<Error>
  publish(): void
  now(): Date
}

// Size in UTF-8 JSON bytes, as a page sends it; anything unserializable is unbounded.
function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/**
 * Asks to sign a message or typed data from a page or agent. A copy of the
 * payload is kept until signing and the request records its hash; an
 * opted-in website sign-in policy may approve it, otherwise it waits for a
 * person. With returnSummary the agent gets the request's summary instead
 * of waiting.
 */
export async function messageRequest(
  access: MessageRequestsAccess,
  context: WalletBrokerContext,
  wallet: WalletDescriptor,
  input: WalletMessageSigningInput,
  rawSigning = false,
  returnSummary = false
): Promise<unknown> {
  const currentWallet = access.requireAccessibleWallet(context, wallet.id)
  access.assertAddressPermission(context, currentWallet, 'sign')
  const retainedInput: WalletMessageSigningInput = input.kind === 'message'
    ? { kind: 'message', message: Uint8Array.from(input.message) }
    : structuredClone(input)
  const serialized = JSON.stringify(walletJsonSafe(retainedInput))
  const messageHash = createHash('sha256')
    .update('hronaut-wallet-message-v1\u0000')
    .update(serialized)
    .digest('hex')
  const record = await access.createRequest(context, currentWallet, 'sign-message', 'sign', {
    messageHash,
    messageKind: retainedInput.kind,
    messageLength: Buffer.byteLength(serialized, 'utf8'),
    rawSigning
  })
  access.pendingMessages.set(record.id, retainedInput)
  try {
    await access.service.approvals.transition(record.id, 'validated', access.now())
    await access.service.approvals.recordSimulation(record.id, { attempted: false, success: false }, access.now())
    await access.service.approvals.transition(record.id, 'simulated', access.now())
    await access.service.approvals.transition(record.id, 'policy-decision', access.now())
    const signIn = access.websiteSignInDecision(context, currentWallet, record.id, retainedInput.kind === 'message'
      ? { kind: 'message', bytes: retainedInput.message, raw: rawSigning }
      : { kind: 'typed-data', typedData: retainedInput.typedData, serializedBytes: jsonBytes(retainedInput.typedData) })
    await access.service.audit.append('request-simulated', {
      requestId: record.id, walletId: wallet.id, success: false, attempted: false,
      policyDecision: signIn?.decision.outcome ?? 'awaiting-human',
      reason: signIn?.decision.reason ?? (rawSigning ? 'raw-signing-requires-human' : 'message-signing-requires-human')
    }, access.now().toISOString())
    if (signIn?.decision.outcome === 'approved') {
      const automatic = await access.approveWebsiteSignIn(
        context, currentWallet, record.id, signIn.policies, signIn.decision.policyId, retainedInput.kind === 'typed-data'
      )
      if (automatic.approved) {
        access.clearRequestExpiry(record.id)
        access.publish()
        return automatic.result
      }
    }
    await access.service.approvals.transition(record.id, 'awaiting-human', access.now())
    if (returnSummary) access.publish()
    return returnSummary
      ? agentSummary(access.service.approvals.get(record.id)!, wallet)
      : access.wait(record.id)
  } catch (error) {
    throw await access.fail(record.id, error)
  }
}
