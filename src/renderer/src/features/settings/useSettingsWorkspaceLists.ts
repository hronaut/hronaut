import { computed, type Ref } from 'vue'
import type { BrowserState } from '../../../../shared/types.js'

/**
 * The workspaces Settings and the wallet approval dialog list: open workspaces by name for wallets, and open and
 * archived workspaces with their tab and site-data counts for browsing data.
 */
export function useSettingsWorkspaceLists(state: Readonly<Ref<BrowserState>>) {
  // Each list stays the same while what it holds stays equal, so Settings and the dialogs do not draw again for a state
  // that changed elsewhere, such as an agent's page getting its title.
  const walletWorkspaces = computed<WalletWorkspace[]>((previous) => sameOrNext(previous,
    state.value.mcpTabGroups.map((workspace) => ({ id: workspace.id, name: workspace.name }))))
  const dataWorkspaces = computed<DataWorkspace[]>((previous) => sameOrNext(previous, [
    ...state.value.mcpTabGroups.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      archived: false,
      tabCount: workspace.tabCount,
      storageOriginCount: workspace.storageOriginCount
    })),
    ...state.value.savedTabGroups.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      archived: true,
      tabCount: workspace.tabs.length,
      storageOriginCount: workspace.storageOriginCount
    }))
  ]))
  return { walletWorkspaces, dataWorkspaces }
}

interface WalletWorkspace { id: string; name: string }
interface DataWorkspace extends WalletWorkspace { archived: boolean; tabCount: number; storageOriginCount: number }

function sameOrNext<Item extends object>(previous: Item[] | undefined, next: Item[]): Item[] {
  const same = previous?.length === next.length && previous.every((item, index) => {
    const before = item as Record<string, unknown>
    const after = next[index] as Record<string, unknown>
    const keys = Object.keys(after)
    return keys.length === Object.keys(before).length && keys.every((key) => before[key] === after[key])
  })
  return same && previous ? previous : next
}
