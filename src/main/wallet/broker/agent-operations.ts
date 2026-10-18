import type { WalletBrokerContext, WalletBrokerOptions } from '../broker.js'
import type { EvmProviderSession } from '../evm-provider.js'
import type { WalletService } from '../service.js'
import type { AccountProviderSession } from '../solana-tron-provider.js'
import { sanitizedError } from './sanitized-error.js'

/** An agent requester's wallet calls still running, whether its session was cancelled, and who waits for the calls to finish. */
export interface AgentOperationLifecycle {
  activeOperations: number
  cancelled: boolean
  drainWaiters: Array<() => void>
}

/**
 * What agent operation tracking needs from the broker, which keeps each
 * agent requester's running operations and whether its session was
 * cancelled, so cancelling an agent waits for its running wallet calls and
 * no later call from that session can start.
 */
export interface AgentOperationsAccess {
  service: Pick<WalletService, 'approvals'>
  options: Pick<WalletBrokerOptions, 'assertAgentAccess'>
  agentOperations: Map<string, AgentOperationLifecycle>
  isShuttingDown(): boolean
  isRequestContextActive(context: WalletBrokerContext): boolean
  clearEvmProviderSessions(predicate: (session: EvmProviderSession) => boolean): void
  clearAccountProviderSessions(predicate: (session: AccountProviderSession) => boolean): void
  queueLifecycle<T>(operation: () => Promise<T>): Promise<T>
  rejectCancelled(): void
}

/**
 * Runs an agent's wallet call as one of its requester's operations, so
 * cancelling the requester waits for it; refuses a cancelled or inactive
 * session and sanitizes the call's errors. Website calls run directly.
 */
export async function withAgentOperation<T>(access: AgentOperationsAccess, context: WalletBrokerContext, operation: () => Promise<T>): Promise<T> {
  if (access.isShuttingDown()) throw new Error('Wallet broker is shutting down')
  if (context.requester.type !== 'agent') return operation()
  const requesterId = context.requester.id
  const lifecycle = access.agentOperations.get(requesterId) ?? {
    activeOperations: 0,
    cancelled: false,
    drainWaiters: []
  }
  access.agentOperations.set(requesterId, lifecycle)
  if (lifecycle.cancelled || !access.isRequestContextActive(context)) {
    if (lifecycle.activeOperations === 0 && access.agentOperations.get(requesterId) === lifecycle) {
      access.agentOperations.delete(requesterId)
    }
    throw new Error('Wallet requester session is no longer active')
  }
  lifecycle.activeOperations += 1
  try {
    try {
      return await operation()
    } catch (error) {
      throw sanitizedError(error)
    }
  } finally {
    lifecycle.activeOperations = Math.max(0, lifecycle.activeOperations - 1)
    if (lifecycle.activeOperations === 0) {
      for (const resolve of lifecycle.drainWaiters.splice(0)) resolve()
      if (!lifecycle.cancelled && access.agentOperations.get(requesterId) === lifecycle) {
        access.agentOperations.delete(requesterId)
      }
    }
  }
}

/** Whether an agent's call was neither aborted nor cancelled with its requester; website calls always are active. */
export function isAgentOperationActive(access: AgentOperationsAccess, context: WalletBrokerContext): boolean {
  if (context.requester.type !== 'agent') return true
  return context.signal?.aborted !== true
    && access.agentOperations.get(context.requester.id)?.cancelled !== true
}

/** Throws when agent access is off or the agent's call or requester session was cancelled. */
export function assertAgentOperationActive(access: AgentOperationsAccess, context: WalletBrokerContext): void {
  if (context.requester.type === 'agent') access.options.assertAgentAccess?.()
  if (!isAgentOperationActive(access, context)) throw new Error('Wallet requester session is no longer active')
}

/**
 * Cancels an agent requester's session: its page connections and wallet
 * requests, once now and again after its running operations finish.
 */
export async function cancelForRequester(access: AgentOperationsAccess, requesterId: string): Promise<void> {
  const lifecycle = access.agentOperations.get(requesterId) ?? {
    activeOperations: 0,
    cancelled: false,
    drainWaiters: []
  }
  access.agentOperations.set(requesterId, lifecycle)
  lifecycle.cancelled = true
  access.clearEvmProviderSessions((session) => (
    session.requester.type === 'agent' && session.requester.id === requesterId
  ))
  access.clearAccountProviderSessions((session) => (
    session.requester.type === 'agent' && session.requester.id === requesterId
  ))
  const cancel = () => access.queueLifecycle(async () => {
    try {
      await access.service.approvals.cancelForRequester(requesterId)
    } finally {
      access.rejectCancelled()
    }
  })
  let cancellationError: unknown
  try {
    await cancel()
  } catch (error) {
    cancellationError = error
  }
  if (lifecycle.activeOperations > 0) {
    await new Promise<void>((resolve) => lifecycle.drainWaiters.push(resolve))
  }
  try {
    await cancel()
  } catch (error) {
    cancellationError ??= error
  }
  if (access.agentOperations.get(requesterId) === lifecycle) access.agentOperations.delete(requesterId)
  if (cancellationError) throw cancellationError
}
