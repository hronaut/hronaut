import type { BrowserSavedTabGroupState, BrowserTabGroupColor, BrowserTabGroupState, BrowserWorkspaceContextClass, BrowserWorkspaceNavigationAuditEntry, BrowserWorkspaceNavigationPolicy } from '../../shared/types.js'

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
}
export interface ArchivedWorkspace extends BrowserSavedTabGroupState {
  contextClass: BrowserWorkspaceContextClass
  storageId: string
  origins: string[]
  navigationAudit: BrowserWorkspaceNavigationAuditEntry[]
}
interface WorkspaceTab { id: string; mcpGroupId?: string; title: string; url: string; pinned: boolean }
interface WorkspaceRuntimePorts {
  maxTabs: number
  maxArchived: number
  tabs(): WorkspaceTab[]
  requireActive(id: string): BrowserTabGroupState
  assertRestoreCapacity(name: string, id: string): void
  withActiveOperation<T>(id: string, action: string, run: () => Promise<T>): Promise<T>
  withArchivedOperation<T>(id: string, action: string, run: () => Promise<T>): Promise<T>
  closeActive(id: string, preserveStorage: boolean): Promise<unknown>
  createTab(tab: { title: string; url: string; pinned: boolean; mcpGroupId: string; allowBusyWorkspace: true; active: false }): Promise<unknown>
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
      const group = host.requireActive(id)
      const tabs = host.tabs().filter(tab => tab.mcpGroupId === id)
      if (!tabs.length) throw new Error(`Workspace "${group.name}" has no tabs to archive.`)
      if (this.archived.size >= host.maxArchived) throw new Error(`Hronaut can keep up to ${host.maxArchived} archived workspaces.`)
      const internal = this.active.get(id)!
      const saved: ArchivedWorkspace = { ...this.publicFields(internal), savedAt: new Date().toISOString(),
        storageId: internal.storageId, origins: [...internal.origins], navigationAudit: [...internal.navigationAudit],
        storageOriginCount: internal.origins.length, tabs: tabs.map(tab => ({ title: tab.title, url: tab.url, pinned: tab.pinned })) }
      await host.closeActive(id, true)
      this.archived.set(id, saved)
      host.remapDownloads(id, id); host.changed()
      return this.publicArchive(saved)
    })
  }
  restore(id: string): Promise<BrowserTabGroupState> {
    const host = this.runtime
    return host.withArchivedOperation(id, 'restoring the archived workspace', async () => {
      const saved = this.archived.get(id)
      if (!saved) throw new Error(`Unknown archived workspace: ${id}.`)
      host.assertRestoreCapacity(saved.name, id)
      if (host.tabs().length + saved.tabs.length > host.maxTabs) throw new Error(`Restoring "${saved.name}" would exceed the ${host.maxTabs}-tab limit.`)
      const now = new Date().toISOString()
      const restored: ActiveWorkspace = { ...this.publicFields(saved), createdAt: now, lastUsedAt: now, activeTabId: null,
        storageId: saved.storageId, origins: [...saved.origins], navigationAudit: [...saved.navigationAudit] }
      this.archived.delete(id); this.active.set(id, restored)
      return host.withActiveOperation(id, 'restoring the archived workspace', async () => {
        try {
          for (const tab of saved.tabs) await host.createTab({ title: tab.title, url: tab.url, pinned: tab.pinned, mcpGroupId: id, allowBusyWorkspace: true, active: false })
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
            throw new AggregateError([error, rollbackError], `Archived workspace "${saved.name}" could not be restored or rolled back. Its recoverable active workspace remains open; close or archive it before retrying.`)
          }
          this.archived.set(id, saved); host.changed(); throw error
        }
      })
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
