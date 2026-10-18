import type { Session } from 'electron'
import type { PersistedBrowserState, TabStateStore } from '../tab-store.js'
import type { ActiveWorkspace, ArchivedWorkspace } from '../workspace-registry.js'

/** The tab manager options flushing workspace profiles uses: the base partition and the session setup. */
export interface QuitFlushOptions {
  partition: string
  configureSession?: (browserSession: Session) => void
}

/**
 * What settling the browser before quit needs from the tab manager, which
 * keeps the pending save timer, the downloads controller, the store, the
 * persisted state, the workspace operations in progress, the workspaces and
 * its options private. The save timer stays a manager field because every
 * state change schedules it.
 */
export interface QuitFlushAccess {
  /** The pending save timer, or null. */
  persistTimer(): NodeJS.Timeout | null
  /** Replaces the pending save timer. */
  setPersistTimer(timer: NodeJS.Timeout | null): void
  /** The downloads controller, for its pending notification. */
  downloadController(): { clearPendingNotification(): void }
  /** Whether the manager finished restoring its tabs. */
  initialized(): boolean
  /** The tab state store. */
  store(): Pick<TabStateStore, 'save'>
  /** The browser state to persist. */
  persistedState(): PersistedBrowserState
  /** The workspace operations in progress. */
  pendingWorkspaceOperationPromises(): ReadonlySet<Promise<unknown>>
  /** The open workspaces by id. */
  mcpTabGroups(): ReadonlyMap<string, ActiveWorkspace>
  /** The archived workspaces by id. */
  savedTabGroups(): ReadonlyMap<string, ArchivedWorkspace>
  /** The tab manager's options. */
  options(): QuitFlushOptions
}
