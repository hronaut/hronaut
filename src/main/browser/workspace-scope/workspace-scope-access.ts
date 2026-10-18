import type { BrowserState, BrowserTabGroupState } from '../../../shared/types.js'
import type { ActiveWorkspace } from '../workspace-registry.js'

/** The tab fields scoping to a workspace reads: its id, workspace and discovery title. */
export interface WorkspaceScopeTab {
  id: string
  mcpGroupId?: string
  discoveryTitle: { value: string }
}

/**
 * What resolving a workspace's tabs and state needs from the tab manager,
 * which keeps the tabs, the open workspaces and the browser state private.
 */
export interface WorkspaceScopeAccess<Tab extends WorkspaceScopeTab> {
  /** The open tabs. */
  tabs(): IterableIterator<Tab>
  /** The tab with this id, if it is still open. */
  findTab(tabId: string): Tab | undefined
  /** The open workspace with this id, if any. */
  findWorkspace(groupId: string): ActiveWorkspace | undefined
  /** The open workspace's state; it throws for an unknown workspace. */
  requireMcpTabGroup(groupId: string): BrowserTabGroupState
  /** The browser state. */
  getState(): BrowserState
}
