import { randomUUID } from 'node:crypto'
import type { WalletAgentDescriptor } from '../../shared/wallet.js'
import type { McpClientActivity } from './http-server.js'

/** Wallet access for MCP agents: the operations the wallet broker supplies and the short-lived agent sessions bound to one tab. */
export interface WalletAgentToolTarget {
  workspaceId: string
  tabId: string
  client: Pick<McpClientActivity, 'id' | 'name' | 'version'>
  signal?: AbortSignal
}

export interface WalletAgentOperations {
  list: (target: WalletAgentToolTarget) => Promise<WalletAgentDescriptor[]>
  balance: (target: WalletAgentToolTarget, walletId: string, token?: string, spender?: string) => Promise<unknown>
  prepareTransaction: (target: WalletAgentToolTarget, walletId: string, transaction: unknown) => Promise<unknown>
  requestTransaction: (target: WalletAgentToolTarget, walletId: string, transaction: unknown, broadcast: boolean) => Promise<unknown>
  requestMessage: (target: WalletAgentToolTarget, walletId: string, message: Uint8Array) => Promise<unknown>
  requestStatus: (target: WalletAgentToolTarget, requestId: string) => Promise<unknown>
  pageRequests?: (target: WalletAgentToolTarget) => Promise<unknown>
  cancelRequest: (target: WalletAgentToolTarget, requestId: string) => Promise<unknown>
  cancelRequester?: (requesterId: string) => Promise<void>
}

interface WalletAgentSession {
  token: string
  ownerClientId: string
  target: WalletAgentToolTarget
  expiresAt: number
  deadlineMonotonic: number
  controller: AbortController
}

export class WalletAgentSessionRegistry {
  private static readonly LIFETIME_MS = 30 * 60_000
  private readonly sessions = new Map<string, WalletAgentSession>()
  private cancellationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly onExpired?: (requesterId: string) => void | Promise<void>) {}

  open(workspaceId: string, tabId: string, client: McpClientActivity, agentName?: string): WalletAgentSession {
    this.expire()
    const token = randomUUID()
    const session: WalletAgentSession = {
      token,
      ownerClientId: client.id,
      controller: new AbortController(),
      target: {
        workspaceId,
        tabId,
        client: {
          id: `wallet-session:${token}`,
          name: agentName?.trim().slice(0, 128) || client.name,
          ...(client.version ? { version: client.version } : {})
        }
      },
      expiresAt: Date.now() + WalletAgentSessionRegistry.LIFETIME_MS,
      // Sessions live only for this process, so a monotonic deadline keeps
      // authorization bounded while expiresAt remains a meaningful UTC value.
      deadlineMonotonic: performance.now() + WalletAgentSessionRegistry.LIFETIME_MS
    }
    session.target.signal = session.controller.signal
    this.sessions.set(token, session)
    return session
  }

  resolve(token: string, workspaceId: string, tabId: string, clientId: string): WalletAgentToolTarget {
    this.expire()
    const session = this.sessions.get(token)
    if (
      !session
      || session.ownerClientId !== clientId
      || session.target.workspaceId !== workspaceId
      || session.target.tabId !== tabId
    ) {
      throw new Error('Wallet agent session is invalid or expired for this workspace and tab')
    }
    session.expiresAt = Date.now() + WalletAgentSessionRegistry.LIFETIME_MS
    session.deadlineMonotonic = performance.now() + WalletAgentSessionRegistry.LIFETIME_MS
    return {
      ...session.target,
      client: { ...session.target.client },
      signal: session.controller.signal
    }
  }

  async clear(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.controller.abort()
      this.scheduleCancellation(session.target.client.id)
    }
    this.sessions.clear()
    await this.cancellationQueue
  }

  async clearOwner(ownerClientId: string): Promise<void> {
    for (const [token, session] of this.sessions) {
      if (session.ownerClientId !== ownerClientId) continue
      this.sessions.delete(token)
      session.controller.abort()
      this.scheduleCancellation(session.target.client.id)
    }
    await this.cancellationQueue
  }

  private expire(): void {
    const wallNow = Date.now()
    const monotonicNow = performance.now()
    for (const [token, session] of this.sessions) {
      if (session.expiresAt > wallNow && session.deadlineMonotonic > monotonicNow) continue
      this.sessions.delete(token)
      session.controller.abort()
      this.scheduleCancellation(session.target.client.id)
    }
  }

  private scheduleCancellation(requesterId: string): void {
    if (!this.onExpired) return
    this.cancellationQueue = this.cancellationQueue
      .then(() => this.onExpired?.(requesterId))
      .catch(() => {
        console.error('[mcp] Failed to cancel wallet requests for an expired agent session.')
      })
  }
}
