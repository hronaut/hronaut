import type { WalletApprovalRecord } from '../approvals.js'
import type { WalletBrokerContext, WalletBrokerOptions, WalletPageCallFailure } from '../broker.js'
import type { EvmCallBundleStore } from '../evm-call-bundles.js'
import type { EvmFilterRegistry } from '../evm-filters.js'
import type { EvmProviderSession } from '../evm-provider.js'
import type { EvmAssetSuggestionLog } from '../evm-watch-asset.js'
import type { WalletPageLog } from '../page-log.js'
import type { WalletService } from '../service.js'
import type { AccountProviderSession } from '../solana-tron-provider.js'

/**
 * What page lifecycle handling needs from the broker, which keeps the closed
 * tabs, the oldest navigation generation each tab still accepts, and the
 * page state a closed page or workspace leaves behind, so a navigated or
 * closed page can neither make nor complete a wallet request.
 */
export interface PageLifecycleAccess {
  service: Pick<WalletService, 'approvals' | 'permissions'>
  options: Pick<WalletBrokerOptions, 'assertAgentAccess'>
  minimumNavigationGeneration: Map<string, number>
  closedTabs: Set<string>
  evmFilters: EvmFilterRegistry
  evmCallBundles: EvmCallBundleStore
  evmAssetSuggestions: EvmAssetSuggestionLog
  pageCallFailures: WalletPageLog<WalletPageCallFailure>
  isShuttingDown(): boolean
  clearEvmProviderSessions(predicate: (session: EvmProviderSession) => boolean): void
  clearAccountProviderSessions(predicate: (session: AccountProviderSession) => boolean): void
  isAgentOperationActive(context: WalletBrokerContext): boolean
  assertAgentOperationActive(context: WalletBrokerContext): void
  queueLifecycle<T>(operation: () => Promise<T>): Promise<T>
  rejectCancelled(): void
}

/** Cancels the wallet requests and connections of earlier pages in a tab that navigated to a new page. */
export async function cancelForNavigation(access: PageLifecycleAccess, tabId: string, generation: number): Promise<void> {
  access.minimumNavigationGeneration.set(
    tabId,
    Math.max(generation, access.minimumNavigationGeneration.get(tabId) ?? 0)
  )
  access.clearEvmProviderSessions((session) => (
    session.tabId === tabId && session.navigationGeneration < generation
  ))
  access.clearAccountProviderSessions((session) => (
    session.tabId === tabId && session.navigationGeneration < generation
  ))
  await access.queueLifecycle(async () => {
    try {
      await access.service.approvals.cancelForNavigation(tabId, generation)
    } finally {
      access.rejectCancelled()
    }
  })
}

/** Cancels a closed tab's wallet requests and forgets its page state; the tab makes no wallet request until it is restored. */
export async function cancelForTab(access: PageLifecycleAccess, tabId: string): Promise<void> {
  access.closedTabs.add(tabId)
  access.clearEvmProviderSessions((session) => session.tabId === tabId)
  access.evmFilters.clear((owner) => owner.tabId === tabId)
  access.evmAssetSuggestions.clear((page) => page.tabId === tabId)
  access.pageCallFailures.clear((page) => page.tabId === tabId)
  access.clearAccountProviderSessions((session) => session.tabId === tabId)
  await access.queueLifecycle(async () => {
    try {
      await access.service.approvals.cancelForTab(tabId)
    } finally {
      access.rejectCancelled()
    }
  })
}

/** Lets a restored tab make wallet requests again, from its current navigation generation on. */
export async function resumeTab(access: PageLifecycleAccess, tabId: string, navigationGeneration: number): Promise<void> {
  if (!Number.isSafeInteger(navigationGeneration) || navigationGeneration < 0) {
    throw new Error('Wallet tab navigation generation is invalid')
  }
  await access.queueLifecycle(async () => {
    access.minimumNavigationGeneration.set(
      tabId,
      Math.max(navigationGeneration, access.minimumNavigationGeneration.get(tabId) ?? 0)
    )
    access.closedTabs.delete(tabId)
  })
}

/** Cancels a closed workspace's wallet requests, revokes its account permissions and forgets its page state. */
export async function cancelForWorkspace(access: PageLifecycleAccess, workspaceId: string): Promise<void> {
  access.clearEvmProviderSessions((session) => session.workspaceId === workspaceId)
  access.evmFilters.clear((owner) => owner.workspaceId === workspaceId)
  access.evmCallBundles.clear((owner) => owner.workspaceId === workspaceId)
  access.evmAssetSuggestions.clear((page) => page.workspaceId === workspaceId)
  access.pageCallFailures.clear((page) => page.workspaceId === workspaceId)
  access.clearAccountProviderSessions((session) => session.workspaceId === workspaceId)
  await access.queueLifecycle(async () => {
    try {
      await Promise.all([
        access.service.approvals.cancelForWorkspace(workspaceId),
        access.service.permissions.revokeForWorkspace(workspaceId)
      ])
    } finally {
      access.rejectCancelled()
    }
  })
}

/** Whether the requesting page is still open on the same navigation, and its agent session, if any, still active. */
export function isRequestContextActive(access: PageLifecycleAccess, context: WalletBrokerContext): boolean {
  const minimumGeneration = access.minimumNavigationGeneration.get(context.tabId)
  return !access.isShuttingDown() && !access.closedTabs.has(context.tabId)
    && (minimumGeneration === undefined || context.navigationGeneration >= minimumGeneration)
    && access.isAgentOperationActive(context)
}

/** Throws unless the broker is running and the requesting page and agent session are still active. */
export function assertRequestContextActive(access: PageLifecycleAccess, context: WalletBrokerContext): void {
  if (access.isShuttingDown()) throw new Error('Wallet broker is shutting down')
  access.assertAgentOperationActive(context)
  const minimumGeneration = access.minimumNavigationGeneration.get(context.tabId)
  if (
    access.closedTabs.has(context.tabId)
    || (minimumGeneration !== undefined && context.navigationGeneration < minimumGeneration)
  ) throw new Error('Wallet request page is no longer active')
}

/** Throws when the page that made a request has navigated away or closed since, or agent access is off for an agent's request. */
export function assertRecordPageActive(access: PageLifecycleAccess, record: WalletApprovalRecord): void {
  if (record.request.requester.type === 'agent') access.options.assertAgentAccess?.()
  const minimumGeneration = access.minimumNavigationGeneration.get(record.request.tabId)
  if (
    access.closedTabs.has(record.request.tabId)
    || (minimumGeneration !== undefined && record.request.navigationGeneration < minimumGeneration)
  ) throw new Error('Wallet request page is no longer active')
}
