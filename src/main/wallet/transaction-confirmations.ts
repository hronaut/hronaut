import type { WalletChainFamily } from '../../shared/wallet.js'
import type { WalletApprovalRecord } from './approvals.js'
import type { WalletChainAdapter, WalletNormalizedTransaction } from './adapters/types.js'
import { restoreWalletJson } from './json-safe.js'
import type { WalletBrokerOptions } from './broker.js'
import type { WalletService } from './service.js'

// A load-balanced node can briefly answer from a backend that lags behind, so a
// transaction counts as replaced only after looking so on this many checks over
// this long, without a longer pause between two checks (such as the computer
// sleeping) than EVM_REPLACED_MAX_CHECK_GAP_MS.
const EVM_REPLACED_TRANSACTION_MS = 60_000
const EVM_REPLACED_TRANSACTION_CHECKS = 3
const EVM_REPLACED_MAX_CHECK_GAP_MS = 30_000
// Replaced transaction hashes kept for wallet_sendCalls batches, which Hronaut also keeps only in memory.
const MAX_REPLACED_TRANSACTION_HASHES = 1_024
const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 2_000

/**
 * What transaction confirmation tracking needs from the broker, which keeps
 * the timers, running checks, replaced-transaction records and shutdown
 * signal, so its shutdown stays authoritative for stopping them.
 */
export interface TransactionConfirmationAccess {
  service: Pick<WalletService, 'approvals' | 'audit' | 'list'>
  adapters: Record<WalletChainFamily, WalletChainAdapter>
  options: Pick<WalletBrokerOptions, 'shutdownDrainTimeoutMs'>
  confirmationTimers: Map<string, ReturnType<typeof setTimeout>>
  confirmationInFlight: Set<string>
  /** Consecutive checks on which a submitted EVM transaction looked replaced by another one with its nonce. */
  replacedChecks: Map<string, { since: number; last: number; count: number }>
  /** Lowercase hashes of sent EVM transactions that failed because another transaction replaced them. */
  replacedTransactionHashes: Set<string>
  confirmationTasks: Set<Promise<void>>
  confirmationShutdown: AbortController
  isShuttingDown(): boolean
  confirmationPollIntervalMs(): number
  publish(): void
  now(): Date
}

/** The nonce a prepared EVM transaction was signed with, if Hronaut recorded one. */
function transactionNonce(record: WalletApprovalRecord): string | undefined {
  if (!record.request.payload.normalized) return undefined
  try {
    return (restoreWalletJson(record.request.payload.normalized) as WalletNormalizedTransaction).nonceOrBlockhash
  } catch {
    return undefined
  }
}

/** Resumes tracking every transaction a previous run submitted and never saw confirmed or failed. */
export function resumeSubmittedConfirmations(access: TransactionConfirmationAccess): void {
  for (const record of access.service.approvals.list()) {
    if (record.status === 'submitted' && record.transactionHash) scheduleConfirmation(access, record.id)
  }
}

/** Checks a submitted transaction on its node after the delay, unless a check is already scheduled or running. */
export function scheduleConfirmation(access: TransactionConfirmationAccess, requestId: string, delay = 0): void {
  if (access.isShuttingDown()) return
  if (access.confirmationTimers.has(requestId) || access.confirmationInFlight.has(requestId)) return
  const timer = setTimeout(() => {
    access.confirmationTimers.delete(requestId)
    if (access.isShuttingDown()) return
    const task = pollConfirmation(access, requestId)
    access.confirmationTasks.add(task)
    void task.finally(() => access.confirmationTasks.delete(task)).catch(() => undefined)
  }, delay)
  timer.unref()
  access.confirmationTimers.set(requestId, timer)
}

async function pollConfirmation(access: TransactionConfirmationAccess, requestId: string): Promise<void> {
  if (access.confirmationInFlight.has(requestId)) return
  access.confirmationInFlight.add(requestId)
  let retry = false
  try {
    const record = access.service.approvals.get(requestId)
    if (record?.status !== 'submitted' || !record.transactionHash) return
    const wallet = access.service.list().find((entry) => entry.id === record.request.walletId)
    if (!wallet) {
      retry = true
      return
    }
    const confirmation = await withConfirmationShutdown(
      access,
      access.adapters[wallet.chainFamily].confirmation(
        wallet,
        record.transactionHash,
        wallet.chainFamily === 'evm' ? transactionNonce(record) : undefined
      )
    )
    const current = access.service.approvals.get(requestId)
    if (current?.status !== 'submitted') return
    const replaced = !confirmation.confirmed && !confirmation.failed && confirmation.replaced === true && replacedLongEnough(access, requestId)
    if (!confirmation.replaced) access.replacedChecks.delete(requestId)
    if (confirmation.confirmed || confirmation.failed || replaced) {
      access.replacedChecks.delete(requestId)
      const terminalStatus = confirmation.confirmed ? 'confirmed' : 'failed'
      try {
        await access.service.approvals.transition(requestId, terminalStatus, access.now())
      } finally {
        if (access.service.approvals.get(requestId)?.status === terminalStatus) {
          if (replaced) rememberReplacedTransaction(access, record.transactionHash)
          await appendTransactionAudit(
            access,
            confirmation.confirmed ? 'transaction-confirmed' : 'transaction-failed',
            record,
            record.transactionHash,
            confirmation.blockReference,
            replaced
          )
        }
        access.publish()
      }
      return
    }
    retry = true
  } catch {
    retry = !access.isShuttingDown() && access.service.approvals.get(requestId)?.status === 'submitted'
  } finally {
    access.confirmationInFlight.delete(requestId)
    if (retry && access.service.approvals.get(requestId)?.status === 'submitted') {
      scheduleConfirmation(access, requestId, access.confirmationPollIntervalMs())
    } else {
      access.replacedChecks.delete(requestId)
    }
  }
}

/**
 * Whether a submitted transaction has looked replaced on enough checks, over
 * long enough, to count as failed. A long pause between two checks, or a
 * clock that went back, starts the count again.
 */
function replacedLongEnough(access: TransactionConfirmationAccess, requestId: string): boolean {
  const now = access.now().getTime()
  const seen = access.replacedChecks.get(requestId)
  const maxGap = Math.max(EVM_REPLACED_MAX_CHECK_GAP_MS, 3 * access.confirmationPollIntervalMs())
  if (!seen || now < seen.last || now - seen.last > maxGap) {
    access.replacedChecks.set(requestId, { since: now, last: now, count: 1 })
    return false
  }
  seen.last = now
  seen.count += 1
  return seen.count >= EVM_REPLACED_TRANSACTION_CHECKS && now - seen.since >= EVM_REPLACED_TRANSACTION_MS
}

function rememberReplacedTransaction(access: TransactionConfirmationAccess, hash: string): void {
  access.replacedTransactionHashes.add(hash.toLowerCase())
  if (access.replacedTransactionHashes.size > MAX_REPLACED_TRANSACTION_HASHES) {
    access.replacedTransactionHashes.delete(access.replacedTransactionHashes.values().next().value!)
  }
}

/** Waits for running confirmation checks; false when they outlast the shutdown drain timeout. */
export function drainConfirmationTasks(access: TransactionConfirmationAccess): Promise<boolean> {
  if (access.confirmationTasks.size === 0) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const finish = (drained: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(drained)
    }
    const timer = setTimeout(() => finish(false), shutdownDrainTimeoutMs(access))
    timer.unref()
    void Promise.allSettled([...access.confirmationTasks]).then(() => finish(true))
  })
}

function withConfirmationShutdown<T>(access: TransactionConfirmationAccess, operation: Promise<T>): Promise<T> {
  const signal = access.confirmationShutdown.signal
  if (signal.aborted) return Promise.reject(new Error('Wallet broker is shutting down'))
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: (value: never) => void, value: unknown): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback(value as never)
    }
    const onAbort = (): void => finish(reject, new Error('Wallet broker is shutting down'))
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => finish(resolve, value),
      (error: unknown) => finish(reject, error)
    )
  })
}

function shutdownDrainTimeoutMs(access: TransactionConfirmationAccess): number {
  const configured = access.options.shutdownDrainTimeoutMs
  return Number.isFinite(configured) && configured !== undefined && configured >= 0
    ? configured
    : DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS
}

/** Records a transaction lifecycle event; a failed write is logged and never fails the request. */
export async function appendTransactionAudit(
  access: TransactionConfirmationAccess,
  type: 'transaction-submitted' | 'transaction-confirmed' | 'transaction-failed',
  record: WalletApprovalRecord,
  transactionHash: string,
  blockReference?: string,
  replaced = false
): Promise<void> {
  try {
    await access.service.audit.append(type, {
      requestId: record.id,
      walletId: record.request.walletId,
      workspaceId: record.request.workspaceId,
      origin: record.request.topLevelOrigin,
      requester: record.request.requester,
      networkId: record.request.networkId,
      transactionHash,
      ...(blockReference ? { blockReference } : {}),
      ...(replaced ? { replaced: true } : {})
    }, access.now().toISOString())
  } catch {
    console.error('[wallet] Failed to persist transaction lifecycle audit event')
  }
}
