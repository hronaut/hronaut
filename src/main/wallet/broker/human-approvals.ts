import type { WalletDescriptor, WalletRequestSummary } from '../../../shared/wallet.js'
import type { WalletApprovalRecord } from '../approvals.js'
import { summary } from '../request-summary.js'
import type { WalletService } from '../service.js'
import type { PendingResult } from './request-records.js'
import { sanitizedError } from './sanitized-error.js'
import { LocalizedError } from '../../localized-error.js'

/**
 * What a person's approval or rejection needs from the broker, which keeps
 * the waiting page promises, the lock generation and the lifecycle queue,
 * so an approval still runs in that queue and fails if signing keys were
 * locked after the person clicked.
 */
export interface HumanApprovalsAccess {
  service: Pick<WalletService, 'approvals' | 'audit' | 'list'>
  pending: Map<string, PendingResult>
  lockGeneration(): number
  queueLifecycle<T>(operation: () => Promise<T>): Promise<T>
  execute(record: WalletApprovalRecord): Promise<unknown>
  fail(requestId: string, error: unknown): Promise<Error>
  rejectPending(requestId: string, error: Error): void
  clearRequestExpiry(requestId: string): void
  requireWallet(walletId: string): WalletDescriptor
  publish(): void
  now(): Date
}

/**
 * Approves a request a person accepted in the wallet prompt, unless signing
 * keys were locked since they clicked, then signs or sends it.
 */
export function approve(access: HumanApprovalsAccess, requestId: string): Promise<WalletRequestSummary> {
  const lockGeneration = access.lockGeneration()
  return access.queueLifecycle(() => {
    if (lockGeneration !== access.lockGeneration()) {
      throw new LocalizedError('appErrors.wallet.requestCancelledLocked')
    }
    return approveRequest(access, requestId)
  })
}

/**
 * Records the approval and executes the request, settling the page's waiting
 * promise; an approval that comes too late leaves the request expired.
 */
async function approveRequest(access: HumanApprovalsAccess, requestId: string): Promise<WalletRequestSummary> {
  const record = access.service.approvals.get(requestId)
  if (!record) throw new LocalizedError('appErrors.wallet.requestNotFound')
  if (record.status !== 'awaiting-human') throw new LocalizedError('appErrors.wallet.requestNotAwaiting')
  try {
    await access.service.approvals.approve(record.id, record.request, access.now())
  } catch (error) {
    const current = access.service.approvals.get(record.id)
    if (current?.status === 'expired') {
      const expired = new LocalizedError('appErrors.wallet.requestExpired')
      try {
        await access.service.audit.append('request-expired', {
          requestId: record.id,
          walletId: record.request.walletId,
          requester: record.request.requester,
          origin: record.request.topLevelOrigin
        }, access.now().toISOString())
      } finally {
        access.rejectPending(record.id, expired)
        access.publish()
      }
      throw expired
    }
    if (current?.status === 'approved') throw await access.fail(record.id, error)
    throw sanitizedError(error)
  }
  try {
    await access.service.audit.append('request-approved', {
      requestId: record.id, walletId: record.request.walletId, approvalHash: record.requestHash,
      requester: record.request.requester, origin: record.request.topLevelOrigin
    }, access.now().toISOString())
    const result = await access.execute(access.service.approvals.get(record.id)!)
    access.pending.get(record.id)?.resolve(result)
    access.pending.delete(record.id)
    access.clearRequestExpiry(record.id)
    access.publish()
    return summary(access.service.approvals.get(record.id)!, access.requireWallet(record.request.walletId))
  } catch (error) {
    throw await access.fail(record.id, error)
  }
}

/** Rejects a request a person declined in the wallet prompt and tells the waiting page. */
export async function reject(access: HumanApprovalsAccess, requestId: string): Promise<WalletRequestSummary> {
  try {
    const record = await access.service.approvals.transition(requestId, 'rejected', access.now())
    await access.service.audit.append('request-rejected', {
      requestId, walletId: record.request.walletId, requester: record.request.requester, origin: record.request.topLevelOrigin
    }, access.now().toISOString())
    return summary(record, access.service.list().find((wallet) => wallet.id === record.request.walletId))
  } finally {
    if (access.service.approvals.get(requestId)?.status === 'rejected') {
      access.rejectPending(requestId, new Error('Wallet request was rejected by the user'))
      access.publish()
    }
  }
}
