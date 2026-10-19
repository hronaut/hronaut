import type { Ref } from 'vue'
import type {
  BrowserState,
  BrowserTabGroupState,
  HronautApi,
  NewTabOptions
} from '../../../shared/types.js'

type NewTabBrowserApi = Pick<HronautApi, 'newTab'>

export interface NewTabShellControllerOptions {
  state: Readonly<Ref<BrowserState>>
  browser: NewTabBrowserApi
  syncState: (operation: Promise<BrowserState> | BrowserState) => Promise<void>
  settingsOpen: Ref<boolean>
  tabSearchOpen: Ref<boolean>
  /** Starts asking for the address; the focus it returns gives way to an overlay the person opens meanwhile. */
  beginAddressFocus: () => (expectedActiveTabId: string) => Promise<unknown>
  expandTabGroup: (groupId: string) => void
  onWorkspaceError: (workspace: BrowserTabGroupState, error: unknown) => void
}

export function useNewTabShellController(options: NewTabShellControllerOptions) {
  async function open(optionsForTab?: NewTabOptions, groupIdToExpand?: string): Promise<boolean> {
    options.settingsOpen.value = false
    options.tabSearchOpen.value = false
    const focusAddress = options.beginAddressFocus()

    const operation = options.browser.newTab(optionsForTab)
    const [createdState] = await Promise.all([
      operation,
      options.syncState(operation)
    ])
    const createdTabId = createdState.activeTabId
    if (!createdTabId || options.state.value.activeTabId !== createdTabId) return false

    if (groupIdToExpand) options.expandTabGroup(groupIdToExpand)
    await focusAddress(createdTabId)
    return options.state.value.activeTabId === createdTabId
  }

  async function openDefault(): Promise<boolean> {
    return open()
  }

  async function openInWorkspace(groupId?: string): Promise<boolean> {
    if (groupId === undefined) return openDefault()
    const workspace = options.state.value.mcpTabGroups.find((candidate) => candidate.id === groupId)
    if (!workspace) return false
    try {
      return await open({ active: true, mcpGroupId: groupId }, groupId)
    } catch (error) {
      options.onWorkspaceError(workspace, error)
      return false
    }
  }

  return {
    openDefault,
    openInWorkspace
  }
}

export type NewTabShellController = ReturnType<typeof useNewTabShellController>
