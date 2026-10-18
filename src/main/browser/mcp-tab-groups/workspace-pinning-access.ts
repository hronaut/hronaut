import type { BrowserState } from '../../../shared/types.js'
import type { ActiveWorkspace } from '../workspace-registry.js'

/**
 * What pinning a workspace to the top of the tab rail needs from the tab
 * manager, which keeps the active workspaces and state publication private.
 */
export interface WorkspacePinningAccess {
  /** The active workspaces, by id. */
  mcpTabGroups(): Map<string, ActiveWorkspace>
  /** Publishes and saves the browser state. */
  changed(): void
  /** The browser state. */
  getState(): BrowserState
}
