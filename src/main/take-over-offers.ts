import type { AgentPresence, AgentTakeOverOffer } from '../shared/agent-presence.js'

export interface TakeOverOffersOptions {
  /** The agents in a workspace, as presence shows them; throws or returns nothing while the agent service is down. */
  agents(workspaceId: string): readonly AgentPresence[] | undefined
  isTabAgentPaused(tabId: string): boolean
  isTabTakenOver(tabId: string): boolean
  /** Pauses agents on the tab; with `takeOver`, records that the person took it over. Resuming hands it back. */
  setTabAgentPaused(tabId: string, paused: boolean, options?: { takeOver?: boolean }): void
  /** Tells the shell the person can take this tab over. */
  sendOffer(offer: AgentTakeOverOffer): void
  onError?(error: unknown): void
  now?(): number
}

/** While the person keeps typing in a page, the shell hears of the offer at most this often. */
export const TAKE_OVER_OFFER_INTERVAL_MS = 1_000

/** Validates the options of a pause from the shell: only a boolean `takeOver`. */
export function tabAgentPauseOptions(value: unknown): { takeOver: boolean } {
  if (value === undefined) return { takeOver: false }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid tab agent pause options')
  const { takeOver, ...rest } = value as { takeOver?: unknown }
  if (Object.keys(rest).length > 0 || (takeOver !== undefined && typeof takeOver !== 'boolean')) throw new TypeError('Invalid tab agent pause options')
  return { takeOver: takeOver === true }
}

/** Main's side of taking a page over from the agent working on it. */
export class TakeOverOffers {
  private lastOffer: { tabId: string; clientKey: string; sentAt: number } | undefined

  constructor(private readonly options: TakeOverOffersOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  /** The agent working on this tab, which the person can take it over from. */
  available(tabId: string, workspaceId: string | undefined): AgentPresence | undefined {
    if (!workspaceId || this.options.isTabAgentPaused(tabId)) return undefined
    try {
      return this.options.agents(workspaceId)?.find((agent) => agent.state === 'working' && agent.lastTabId === tabId)
    } catch {
      return undefined
    }
  }

  /** The person clicked or typed in a page, so the shell offers a take over when an agent is working on it. */
  touched(tabId: string, workspaceId: string | undefined): void {
    const agent = this.available(tabId, workspaceId)
    if (!agent) return
    const now = this.now()
    const last = this.lastOffer
    // The shell's offer lasts from the latest touch, so a repeat within the interval adds nothing.
    if (last?.tabId === tabId && last.clientKey === agent.clientKey && now - last.sentAt < TAKE_OVER_OFFER_INTERVAL_MS) return
    this.lastOffer = { tabId, clientKey: agent.clientKey, sentAt: now }
    this.options.sendOffer({ tabId, clientKey: agent.clientKey })
  }

  /** Agents were paused on the tab, which ends its offer; the next touch after a resume offers again at once. */
  paused(tabId: string): void {
    if (this.lastOffer?.tabId === tabId) this.lastOffer = undefined
  }

  /**
   * Ctrl/Cmd+Shift+O pressed in a page takes over exactly that tab, whichever one the shell shows. The key reaches
   * main only while an agent is working there; this checks again, since presence can change in between.
   */
  takeOverFromPage(tabId: string, workspaceId: string | undefined): boolean {
    if (!this.available(tabId, workspaceId)) return false
    try {
      this.options.setTabAgentPaused(tabId, true, { takeOver: true })
    } catch (error) {
      this.options.onError?.(error)
      return false
    }
    this.paused(tabId)
    return true
  }

  /** The person said they finished what an agent asked of them on a tab they took over: that hands the tab back too. */
  resolvedOn(tabId: string | undefined): void {
    if (!tabId || !this.options.isTabTakenOver(tabId)) return
    try {
      this.options.setTabAgentPaused(tabId, false)
    } catch (error) {
      this.options.onError?.(error)
    }
  }
}
