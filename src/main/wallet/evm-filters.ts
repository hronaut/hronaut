import { EVM_FILTER_CREATE_RPC_METHODS } from '../../shared/wallet.js'

/** Filters a page may keep at once; creating more forgets its oldest. */
export const MAX_EVM_FILTERS_PER_PAGE = 32
/** Pages whose filters are remembered at once; a new page forgets the least recently used. */
export const MAX_EVM_FILTER_PAGES = 64

const FILTER_ID = /^0x[0-9a-fA-F]{1,64}$/

/** The page document and network a filter was created for. */
export interface EvmFilterOwner {
  workspaceId: string
  tabId: string
  navigationGeneration: number
  topLevelOrigin: string
  /** The node the filter lives on: the wallet network's chain ID and RPC URL. */
  networkId: string
  rpcUrl: string
}

interface PageFilters {
  owner: EvmFilterOwner
  ids: Set<string>
}

export function isEvmFilterCreateMethod(method: string): boolean {
  return (EVM_FILTER_CREATE_RPC_METHODS as readonly string[]).includes(method)
}

/**
 * Node filters are shared by everyone using the same RPC, and local nodes
 * number them 0x1, 0x2 and so on, so one page could read or remove another
 * page's filter by guessing its ID. Hronaut remembers which page document
 * created each filter on which node, and lets only that document use it.
 */
export class EvmFilterRegistry {
  private readonly pages = new Map<string, PageFilters>()

  add(owner: EvmFilterOwner, id: unknown): void {
    if (typeof id !== 'string' || !FILTER_ID.test(id)) return
    const key = ownerKey(owner)
    const page = this.pages.get(key) ?? { owner, ids: new Set<string>() }
    this.pages.delete(key)
    this.pages.set(key, page)
    page.ids.delete(id.toLowerCase())
    page.ids.add(id.toLowerCase())
    for (const oldest of page.ids) {
      if (page.ids.size <= MAX_EVM_FILTERS_PER_PAGE) break
      page.ids.delete(oldest)
    }
    for (const [leastRecent] of this.pages) {
      if (this.pages.size <= MAX_EVM_FILTER_PAGES) break
      this.pages.delete(leastRecent)
    }
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
      if (predicate(page.owner)) this.pages.delete(key)
    }
  }
}

function ownerKey(owner: EvmFilterOwner): string {
  return JSON.stringify([owner.workspaceId, owner.tabId, owner.navigationGeneration, owner.topLevelOrigin, owner.networkId, owner.rpcUrl])
}
