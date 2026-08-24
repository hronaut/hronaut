import type { BrowserTabGroupState } from '../../../shared/types.js'
import {
  useAddressFocusController,
  type AddressFocusControllerOptions
} from './useAddressFocusController.js'
import { useNewTabShellController } from './useNewTabShellController.js'

export interface TabNavigationControllerOptions extends AddressFocusControllerOptions {
  expandTabGroup: (groupId: string) => void
  onWorkspaceError: (workspace: BrowserTabGroupState, error: unknown) => void
}

export function useTabNavigationController(options: TabNavigationControllerOptions) {
  const { focus: focusAddress } = useAddressFocusController(options)
  const {
    openDefault: openNewTab,
    openInWorkspace: newTabInWorkspace
  } = useNewTabShellController({
    state: options.state,
    browser: options.browser,
    syncState: options.syncState,
    settingsOpen: options.settingsOpen,
    tabSearchOpen: options.tabSearchOpen,
    focusAddress: async (expectedActiveTabId) => { await focusAddress(expectedActiveTabId) },
    expandTabGroup: options.expandTabGroup,
    onWorkspaceError: options.onWorkspaceError
  })

  return {
    focusAddress,
    openNewTab,
    newTabInWorkspace
  }
}

export type TabNavigationController = ReturnType<typeof useTabNavigationController>
