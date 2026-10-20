import type { BrowserSavedTabGroupState, BrowserTabGroupColor, BrowserTabGroupState, BrowserWorkspaceContextClass, BrowserWorkspaceNavigationAuditEntry, BrowserWorkspaceNavigationPolicy } from '../../shared/types.js'
import { LocalizedError } from '../localized-error.js'
import type { OpenWorkspaceOperationAction, WorkspaceOperationAction } from './workspace-operations/workspace-operations-access.js'

export interface ActiveWorkspace {
  hiddenFromSidebar?: boolean
  deletionProtected?: boolean
  agentAccess?: boolean
  contextClass: BrowserWorkspaceContextClass
  id: string
  name: string
  description: string
  color: BrowserTabGroupColor
  createdAt: string
  lastUsedAt: string
  activeTabId: string | null
  storageId: string
  origins: string[]
  navigationPolicy: BrowserWorkspaceNavigationPolicy
  navigationAudit: BrowserWorkspaceNavigationAuditEntry[]
  /** When the person pinned it to the top of the tab rail; see BrowserTabGroupState.pinnedAt. */
  pinnedAt?: string
}
export interface ArchivedWorkspace extends BrowserSavedTabGroupState {
  contextClass: BrowserWorkspaceContextClass
  storageId: string
  origins: string[]
  navigationAudit: BrowserWorkspaceNavigationAuditEntry[]
}
interface WorkspaceTab { label?: string; id: string; mcpGroupId?: string; title: string; url: string; pinned: boolean }
interface WorkspaceRuntimePorts {
  maxTabs: number
  maxArchived: number
  tabs(): WorkspaceTab[]
  requireActive(id: string): BrowserTabGroupState
  assertRestoreCapacity(name: string, id: string): void
  withActiveOperation<T>(id: string, action: OpenWorkspaceOperationAction, run: () => Promise<T>): Promise<T>
  withArchivedOperation<T>(id: string, action: WorkspaceOperationAction, run: () => Promise<T>): Promise<T>
  closeActive(id: string, preserveStorage: boolean): Promise<unknown>
  createTab(tab: { label?: string; title: string; url: string; pinned: boolean; mcpGroupId: string; allowBusyWorkspace: true; active: false }): Promise<unknown>
  selectTab(id: string): unknown
  remapDownloads(from: string, to: string): void
  changed(): void
}

/** Owns the active/archive identity transition. TabRuntime retains Electron and
 * storage rollback; AutomationGateway retains dispatch/lease/origin authority.
 * Maps are shared only with the composing TabRuntime during this staged split. */
export class WorkspaceRegistry {
  readonly active = new Map<string, ActiveWorkspace>()
  readonly archived = new Map<string, ArchivedWorkspace>()
  // Archive places held by workspaces still being archived or restored. Closing or reopening tabs takes a while and
  // other workspaces' operations run meanwhile, so counting only finished archives would let two archives started
  // together both take the last place, and a saved state over the limit stops the next start.
  private reservedArchivePlaces = 0
  constructor(private readonly runtime: WorkspaceRuntimePorts) {}

  publicArchive(group: ArchivedWorkspace): BrowserSavedTabGroupState {
    return { id: group.id, name: group.name, description: group.description, color: group.color,
      savedAt: group.savedAt, hiddenFromSidebar: group.hiddenFromSidebar === true,
      deletionProtected: group.deletionProtected === true, agentAccess: group.agentAccess !== false,
      contextClass: group.contextClass, storageOriginCount: group.origins.length,
      navigationPolicy: { mode: group.navigationPolicy.mode, rules: [...group.navigationPolicy.rules] },
      tabs: group.tabs.map(tab => ({ ...tab })) }
  }
  listArchived(): BrowserSavedTabGroupState[] {
    return [...this.archived.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).map(group => this.publicArchive(group))
  }
  archive(id: string): Promise<BrowserSavedTabGroupState> {
    const host = this.runtime
    return host.withActiveOperation(id, 'archiving the workspace', async () => {
      host.requireActive(id)
      const tabs = host.tabs().filter(tab => tab.mcpGroupId === id)
      if (this.archived.size + this.reservedArchivePlaces >= host.maxArchived) throw new LocalizedError('appErrors.workspace.archiveLimit', { max: host.maxArchived })
      const internal = this.active.get(id)!
      const saved: ArchivedWorkspace = { ...this.publicFields(internal), savedAt: new Date().toISOString(),
        storageId: internal.storageId, origins: [...internal.origins], navigationAudit: [...internal.navigationAudit],
        storageOriginCount: internal.origins.length, tabs: tabs.map(tab => ({ title: tab.title, url: tab.url, pinned: tab.pinned, ...(tab.label ? { label: tab.label } : {}) })) }
      this.reservedArchivePlaces++
      try { await host.closeActive(id, true) } finally { this.reservedArchivePlaces-- }
      this.archived.set(id, saved)
      host.remapDownloads(id, id); host.changed()
      return this.publicArchive(saved)
    })
  }
  restore(id: string): Promise<BrowserTabGroupState> {
    const host = this.runtime
    return host.withArchivedOperation(id, 'restoring the archived workspace', async () => {
      const saved = this.archived.get(id)
      if (!saved) throw new LocalizedError('appErrors.workspace.archivedUnavailable', undefined, { message: `Unknown archived workspace: ${id}.` })
      host.assertRestoreCapacity(saved.name, id)
      if (host.tabs().length + saved.tabs.length > host.maxTabs) throw new LocalizedError('appErrors.workspace.restoreTabLimit', { name: saved.name, max: host.maxTabs })
      const now = new Date().toISOString()
      const restored: ActiveWorkspace = { ...this.publicFields(saved), createdAt: now, lastUsedAt: now, activeTabId: null,
        storageId: saved.storageId, origins: [...saved.origins], navigationAudit: [...saved.navigationAudit] }
      // Until its tabs are open, the archive keeps its place for a rollback.
      this.archived.delete(id); this.active.set(id, restored); this.reservedArchivePlaces++
      try {
        return await host.withActiveOperation(id, 'restoring the archived workspace', async () => {
          try {
            for (const tab of saved.tabs) await host.createTab({ label: tab.label, title: tab.title, url: tab.url, pinned: tab.pinned, mcpGroupId: id, allowBusyWorkspace: true, active: false })
            const tabs = host.tabs().filter(tab => tab.mcpGroupId === id)
            if (tabs.length) host.selectTab(tabs[tabs.length - 1]!.id)
            const result = host.requireActive(id)
            host.changed(); host.remapDownloads(id, id)
            return result
          } catch (error) {
            // Never give an archive and active workspace the same partition.
            // Publish the archive only after removing every temporary active tab.
            try { await host.closeActive(id, true) }
            catch (rollbackError) {
              host.remapDownloads(id, id); host.changed()
              throw new LocalizedError('appErrors.workspace.restoreRollbackFailed', { name: saved.name }, { cause: new AggregateError([error, rollbackError]) })
            }
            this.archived.set(id, saved); host.changed(); throw error
          }
        })
      } finally {
        this.reservedArchivePlaces--
      }
    })
  }
  private publicFields(group: ActiveWorkspace | ArchivedWorkspace) {
    return { id: group.id, name: group.name, description: group.description, color: group.color,
      hiddenFromSidebar: group.hiddenFromSidebar === true, deletionProtected: group.deletionProtected === true,
      agentAccess: group.agentAccess !== false, contextClass: group.contextClass,
      navigationPolicy: { mode: group.navigationPolicy.mode, rules: [...group.navigationPolicy.rules] } }
  }
  /** Called after the host drains workspace operations and closes its tabs. */
  dispose(): void { this.active.clear(); this.archived.clear() }
}
