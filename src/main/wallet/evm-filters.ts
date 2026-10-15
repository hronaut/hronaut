import { EVM_FILTER_CREATE_RPC_METHODS, type WalletDescriptor } from '../../shared/wallet.js'

/** Filters a page may keep at once; it must remove one before creating more. */
export const MAX_EVM_FILTERS_PER_PAGE = 32
/** Pages whose filters are remembered at once; a new page forgets the least recently used. */
export const MAX_EVM_FILTER_PAGES = 64

const FILTER_ID = /^0x[0-9a-fA-F]{1,64}$/

/** The tab and site a filter was created for, and the wallet whose node holds it. */
export interface EvmFilterOwner {
  workspaceId: string
  tabId: string
  topLevelOrigin: string
  wallet: WalletDescriptor
}

interface PageFilters {
  owner: EvmFilterOwner
  ids: Set<string>
}

export function isEvmFilterCreateMethod(method: string): boolean {
  return (EVM_FILTER_CREATE_RPC_METHODS as readonly string[]).includes(method)
}

export function isEvmFilterId(value: unknown): value is string {
  return typeof value === 'string' && FILTER_ID.test(value)
}

/**
 * Node filters are shared by everyone using the same RPC, and some local
 * nodes number them 0x1, 0x2 and so on, so one site could read or remove
 * another site's filter by guessing its ID. Hronaut remembers which tab and
 * site created each filter on which node, and lets only that page use it. A
 * filter stays with its page across the site's own navigations, such as a
 * dApp's route changes, because its listeners keep polling the same ID.
 * Filters Hronaut forgets are passed to `forget` so they can be removed from
 * the node.
 */
export class EvmFilterRegistry {
  private readonly pages = new Map<string, PageFilters>()

  constructor(private readonly forget: (owner: EvmFilterOwner, ids: string[]) => void = () => undefined) {}

  isFull(owner: EvmFilterOwner): boolean {
    return (this.pages.get(ownerKey(owner))?.ids.size ?? 0) >= MAX_EVM_FILTERS_PER_PAGE
  }

  /** Records a filter for the page, or returns false when the page already keeps the most it may. */
  add(owner: EvmFilterOwner, id: string): boolean {
    const key = ownerKey(owner)
    const normalized = id.toLowerCase()
    const node = nodeKey(owner.wallet)
    // A restarted node can hand out an ID again; it now belongs only to this page.
    for (const [otherKey, other] of this.pages) {
      if (otherKey === key || nodeKey(other.owner.wallet) !== node) continue
      other.ids.delete(normalized)
      if (other.ids.size === 0) this.pages.delete(otherKey)
    }
    const page = this.pages.get(key) ?? { owner, ids: new Set<string>() }
    if (!page.ids.has(normalized) && page.ids.size >= MAX_EVM_FILTERS_PER_PAGE) return false
    page.ids.add(normalized)
    this.pages.delete(key)
    this.pages.set(key, page)
    for (const [leastRecent, evicted] of this.pages) {
      if (this.pages.size <= MAX_EVM_FILTER_PAGES) break
      this.pages.delete(leastRecent)
      this.forget(evicted.owner, [...evicted.ids])
    }
    return true
  }

  /** Whether this page created the filter; a page that polls its filters stays remembered. */
  owns(owner: EvmFilterOwner, id: unknown): boolean {
    const key = ownerKey(owner)
    const page = this.pages.get(key)
    if (typeof id !== 'string' || !page?.ids.has(id.toLowerCase())) return false
    this.pages.delete(key)
    this.pages.set(key, page)
    return true
  }

  remove(owner: EvmFilterOwner, id: unknown): void {
    if (typeof id !== 'string') return
    const key = ownerKey(owner)
    const page = this.pages.get(key)
    page?.ids.delete(id.toLowerCase())
    if (page?.ids.size === 0) this.pages.delete(key)
  }

  clear(predicate: (owner: EvmFilterOwner) => boolean): void {
    for (const [key, page] of this.pages) {
      if (!predicate(page.owner)) continue
      this.pages.delete(key)
      this.forget(page.owner, [...page.ids])
    }
  }
}

function nodeKey(wallet: WalletDescriptor): string {
  return JSON.stringify([wallet.network.id, wallet.network.rpcUrl])
}

function ownerKey(owner: EvmFilterOwner): string {
  return JSON.stringify([owner.workspaceId, owner.tabId, owner.topLevelOrigin, nodeKey(owner.wallet)])
}
