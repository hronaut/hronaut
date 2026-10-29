import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useSettingsWorkspaceLists } from '../../src/renderer/src/features/settings/useSettingsWorkspaceLists.js'
import type { BrowserState } from '../../src/shared/types.js'

function browserState(): BrowserState {
  return {
    mcpTabGroups: [{ id: 'open-1', name: 'Client A', tabCount: 3, storageOriginCount: 2 }],
    savedTabGroups: [{ id: 'saved-1', name: 'Client B', tabs: [{}, {}], storageOriginCount: 5 }]
  } as unknown as BrowserState
}

describe('useSettingsWorkspaceLists', () => {
  it('lists open workspaces for wallets and open plus archived workspaces for browsing data', () => {
    const { walletWorkspaces, dataWorkspaces } = useSettingsWorkspaceLists(ref(browserState()))
    expect(walletWorkspaces.value).toEqual([{ id: 'open-1', name: 'Client A' }])
    expect(dataWorkspaces.value).toEqual([
      { id: 'open-1', name: 'Client A', archived: false, tabCount: 3, storageOriginCount: 2 },
      { id: 'saved-1', name: 'Client B', archived: true, tabCount: 2, storageOriginCount: 5 }
    ])
  })

  it('follows the browser state when it changes', () => {
    const state = ref(browserState())
    const { walletWorkspaces, dataWorkspaces } = useSettingsWorkspaceLists(state)
    state.value = { ...state.value, mcpTabGroups: [], savedTabGroups: [] }
    expect(walletWorkspaces.value).toEqual([])
    expect(dataWorkspaces.value).toEqual([])
  })
})
