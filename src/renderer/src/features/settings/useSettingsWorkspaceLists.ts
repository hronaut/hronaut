import { computed, type Ref } from 'vue'
import type { BrowserState } from '../../../../shared/types.js'

/**
 * The workspaces Settings and the wallet approval dialog list: open workspaces by name for wallets, and open and
 * archived workspaces with their tab and site-data counts for browsing data.
 */
export function useSettingsWorkspaceLists(state: Readonly<Ref<BrowserState>>) {
  const walletWorkspaces = computed(() => state.value.mcpTabGroups.map((workspace) => ({ id: workspace.id, name: workspace.name })))
  const dataWorkspaces = computed(() => [
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
  ])
  return { walletWorkspaces, dataWorkspaces }
}
