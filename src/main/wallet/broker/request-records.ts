import { randomUUID } from 'node:crypto'
import type { WalletDescriptor, WalletOperation, WalletOperationRequest } from '../../../shared/wallet.js'
import type { WalletApprovalRecord } from '../approvals.js'
import type { WalletBrokerContext, WalletBrokerOptions } from '../broker.js'
import type { WalletService } from '../service.js'
import { sanitizedError } from './sanitized-error.js'

/** How to settle the promise a page or agent waits on while a person decides a request. */
export interface PendingResult {
  resolve(value: unknown): void
  reject(error: Error): void
}

/**
 * What wallet request records need from the broker, which keeps the page
 * promises waiting on a person and each request's expiry timer, so a
 * request that fails, expires or is cancelled always settles the page that
 * waits on it.
 */
export interface RequestRecordsAccess {
  service: Pick<WalletService, 'approvals' | 'audit'>
  options: Pick<WalletBrokerOptions, 'requestTtlMs' | 'requestExpiryScheduler'>
  pending: Map<string, PendingResult>
  requestExpiryCancellations: Map<string, () => void>
  assertRequestContextActive(context: WalletBrokerContext): void
  isRequestContextActive(context: WalletBrokerContext): boolean
  assertAgentOperationActive(context: WalletBrokerContext): void
  rejectCancelled(): void
  rejectPending(requestId: string, error: Error): void
  queueLifecycle<T>(operation: () => Promise<T>): Promise<T>
  publish(): void
  now(): Date
}

const DEFAULT_REQUEST_TTL_MS = 5 * 60_000

const EXPIRABLE_REQUEST_STATUSES = new Set([
  'draft', 'validated', 'simulated', 'policy-decision', 'awaiting-human', 'approved'
])

const TERMINAL_REQUEST_STATUSES = new Set([
  'confirmed', 'rejected', 'expired', 'cancelled', 'failed'
])

/**
 * Creates and audits the approval record for a page's or agent's request,
 * with its expiry, and cancels it again if the page went away meanwhile.
 */
export async function createRequest(
  access: RequestRecordsAccess,
  context: WalletBrokerContext,
  wallet: WalletDescriptor,
  operation: WalletOperation,
  capability: 'read' | 'sign' | 'send',
  payload: Record<string, unknown>
): Promise<WalletApprovalRecord> {
  access.assertRequestContextActive(context)
  const now = access.now()
  const request: WalletOperationRequest = {
    requestId: randomUUID(), walletId: wallet.id, workspaceId: context.workspaceId, tabId: context.tabId,
    navigationGeneration: context.navigationGeneration, topLevelOrigin: context.topLevelOrigin,
    requester: structuredClone(context.requester), capability, chainFamily: wallet.chainFamily,
    networkId: wallet.network.id, operation, payload,
    expiresAt: new Date(now.getTime() + requestTtlMs(access)).toISOString()
  }
  const record = await access.service.approvals.create(request, `${context.requester.type}:${context.requester.id}:${request.requestId}`, now)
  if (!access.isRequestContextActive(context)) {
    const current = access.service.approvals.get(record.id)
    try {
      if (current && EXPIRABLE_REQUEST_STATUSES.has(current.status)) {
        await access.service.approvals.cancel(record.id, access.now())
      }
    } finally {
      access.rejectCancelled()
    }
    access.assertAgentOperationActive(context)
    throw new Error('Wallet request page is no longer active')
  }
  try {
    await access.service.audit.append('request-created', {
      requestId: record.id, walletId: wallet.id, workspaceId: context.workspaceId, origin: context.topLevelOrigin,
      requester: context.requester, operation
    }, now.toISOString())
    scheduleRequestExpiry(access, record)
    access.publish()
    return record
  } catch (error) {
    throw await fail(access, record.id, error)
  }
}

/** Waits for a person to approve or reject a request that is still open. */
export function wait(access: RequestRecordsAccess, requestId: string): Promise<unknown> {
  const record = access.service.approvals.get(requestId)
  if (!record || !EXPIRABLE_REQUEST_STATUSES.has(record.status)) {
    clearRequestExpiry(access, requestId)
    return Promise.reject(new Error(`Wallet request was ${record?.status ?? 'not found'}`))
  }
  return new Promise((resolve, reject) => {
    access.pending.set(requestId, { resolve, reject })
    access.publish()
  })
}

/**
 * Marks a request failed, unless it already ended, and settles the page that
 * waits on it. Returns the error the page and agent see.
 */
export async function fail(access: RequestRecordsAccess, requestId: string, error: unknown): Promise<Error> {
  const record = access.service.approvals.get(requestId)
  let failure = terminalRequestFailure(record) ?? sanitizedError(error)
  try {
    if (record && !TERMINAL_REQUEST_STATUSES.has(record.status)) {
      try {
        await access.service.approvals.transition(requestId, 'failed', access.now())
        await access.service.audit.append('request-failed', { requestId, error: failure.message }, access.now().toISOString())
      } catch (transitionError) {
        const concurrentTerminalFailure = terminalRequestFailure(access.service.approvals.get(requestId))
        if (!concurrentTerminalFailure) throw transitionError
        failure = concurrentTerminalFailure
      }
    }
  } finally {
    failure = terminalRequestFailure(access.service.approvals.get(requestId)) ?? failure
    access.rejectPending(requestId, failure)
    access.publish()
  }
  return failure
}

/** The error for a request that was cancelled, expired or rejected, if it was. */
function terminalRequestFailure(record: WalletApprovalRecord | undefined): Error | undefined {
  if (record?.status === 'cancelled') return new Error('Wallet request was cancelled')
  if (record?.status === 'expired') return new Error('Wallet request was expired')
  if (record?.status === 'rejected') return new Error('Wallet request was rejected by the user')
  return undefined
}

/** Expires a request at its expiry time unless it ends first. */
function scheduleRequestExpiry(access: RequestRecordsAccess, record: WalletApprovalRecord): void {
  clearRequestExpiry(access, record.id)
  const delay = Math.max(0, Date.parse(record.request.expiresAt) - access.now().getTime())
  const expire = () => {
    access.requestExpiryCancellations.delete(record.id)
    void access.queueLifecycle(() => expireRequest(access, record.id)).catch(() => undefined)
  }
  const cancel = access.options.requestExpiryScheduler?.(expire, delay) ?? (() => {
    const timer = setTimeout(expire, delay)
    timer.unref()
    return () => clearTimeout(timer)
  })()
  access.requestExpiryCancellations.set(record.id, cancel)
}

/** Expires a request that is still open past its expiry time and tells the waiting page. */
async function expireRequest(access: RequestRecordsAccess, requestId: string): Promise<void> {
  const record = access.service.approvals.get(requestId)
  if (!record || !EXPIRABLE_REQUEST_STATUSES.has(record.status)) return
  const now = access.now()
  if (Date.parse(record.request.expiresAt) > now.getTime()) {
    scheduleRequestExpiry(access, record)
    return
  }
  try {
    await access.service.approvals.transition(requestId, 'expired', now)
    await access.service.audit.append('request-expired', {
      requestId,
      walletId: record.request.walletId,
      requester: record.request.requester,
      origin: record.request.topLevelOrigin
    }, now.toISOString())
  } finally {
    access.rejectPending(requestId, new Error('Wallet request expired'))
    access.publish()
  }
}

/** Stops a request's expiry timer. */
export function clearRequestExpiry(access: RequestRecordsAccess, requestId: string): void {
  access.requestExpiryCancellations.get(requestId)?.()
  access.requestExpiryCancellations.delete(requestId)
}

/** How long a request may wait for a person, at most five minutes. */
function requestTtlMs(access: RequestRecordsAccess): number {
  const value = access.options.requestTtlMs ?? DEFAULT_REQUEST_TTL_MS
  if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_REQUEST_TTL_MS) {
    throw new Error('Wallet request expiry must be between 1 ms and 5 minutes')
  }
  return value
}
