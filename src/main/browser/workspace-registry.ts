import type { BrowserSavedTabGroupState, BrowserSavedTabGroupTab, BrowserTabGroupColor, BrowserTabGroupState, BrowserWorkspaceContextClass, BrowserWorkspaceNavigationAuditEntry, BrowserWorkspaceNavigationPolicy } from '../../shared/types.js'
import { LocalizedError } from '../localized-error.js'
import type { OpenWorkspaceOperationAction, WorkspaceOperationAction } from './workspace-operations/workspace-operations.js'

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
/** An archived tab, with the page settings it had, which the browser state does not publish. */
export interface ArchivedWorkspaceTab extends BrowserSavedTabGroupTab {
  zoomIsolated?: true
  defaultFontSize?: number
  /** The tab's own mute, not the browser-wide one. */
  muted?: true
  /** Agents paused in the tab itself, not by pausing all agents. */
  tabAgentPaused?: true
  /** The person's input locked in the tab itself, not by locking every tab. */
  humanInteractionLocked?: true
}
export interface ArchivedWorkspace extends BrowserSavedTabGroupState {
  contextClass: BrowserWorkspaceContextClass
  storageId: string
  origins: string[]
  navigationAudit: BrowserWorkspaceNavigationAuditEntry[]
  tabs: ArchivedWorkspaceTab[]
  /** Which of its tabs was shown when it was archived, which restoring it shows again. */
  shownTabIndex?: number
}
/** Where an archived workspace goes back in the tab rail, as Undo puts it back. */
export interface WorkspacePlacement {
  /** Its place among the open workspaces when it was archived. */
  index: number
  /** The open workspaces right before and after it then, which it goes back next to while either is still open. */
  after?: string
  before?: string
  pinnedAt?: string
}
interface WorkspaceTab { label?: string; id: string; mcpGroupId?: string; title: string; url: string; pinned: boolean; zoomIsolated?: boolean; defaultFontSize?: number; tabMuted?: boolean; tabAgentPaused?: boolean; humanInteractionLocked?: boolean }
interface WorkspaceRuntimePorts {
  maxTabs: number
  maxArchived: number
  tabs(): WorkspaceTab[]
  requireActive(id: string): BrowserTabGroupState
  assertRestoreCapacity(name: string, id: string): void
  withActiveOperation<T>(id: string, action: OpenWorkspaceOperationAction, run: () => Promise<T>): Promise<T>
  withArchivedOperation<T>(id: string, action: WorkspaceOperationAction, run: () => Promise<T>): Promise<T>
  closeActive(id: string, preserveStorage: boolean): Promise<unknown>
  createTab(tab: { label?: string; title: string; url: string; pinned: boolean; zoomIsolated: boolean; defaultFontSize?: number; muted: boolean
    tabAgentPaused: boolean; humanInteractionLocked: boolean; mcpGroupId: string; allowBusyWorkspace: true; active: false; loadsInTurn: boolean }): Promise<unknown>
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
      tabs: group.tabs.map(tab => ({ title: tab.title, url: tab.url, pinned: tab.pinned, ...(tab.label ? { label: tab.label } : {}) })) }
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
      const shownTabIndex = tabs.findIndex(tab => tab.id === internal.activeTabId)
      const saved: ArchivedWorkspace = { ...this.publicFields(internal), savedAt: new Date().toISOString(),
        storageId: internal.storageId, origins: [...internal.origins], navigationAudit: [...internal.navigationAudit],
        storageOriginCount: internal.origins.length, tabs: tabs.map(tab => ({ title: tab.title, url: tab.url, pinned: tab.pinned,
          ...(tab.label ? { label: tab.label } : {}), ...(tab.zoomIsolated ? { zoomIsolated: true as const } : {}),
          ...(tab.defaultFontSize ? { defaultFontSize: tab.defaultFontSize } : {}), ...(tab.tabMuted ? { muted: true as const } : {}),
          ...(tab.tabAgentPaused ? { tabAgentPaused: true as const } : {}),
          ...(tab.humanInteractionLocked ? { humanInteractionLocked: true as const } : {}) })),
        ...(shownTabIndex >= 0 ? { shownTabIndex } : {}) }
      this.reservedArchivePlaces++
      try { await host.closeActive(id, true) } finally { this.reservedArchivePlaces-- }
      this.archived.set(id, saved)
      host.remapDownloads(id, id); host.changed()
      return this.publicArchive(saved)
    })
  }
  /**
   * Restores an archived workspace at the end of the tab rail, or, for Undo, where it was and pinned as it was, and
   * shows the tab that was shown when it was archived. With `show` false, as for an agent, the window stays as it is
   * and that tab only becomes the workspace's remembered tab.
   */
  restore(id: string, placement?: WorkspacePlacement, show = true): Promise<BrowserTabGroupState> {
    const host = this.runtime
    return host.withArchivedOperation(id, 'restoring the archived workspace', async () => {
      const saved = this.archived.get(id)
      if (!saved) throw new LocalizedError('appErrors.workspace.archivedUnavailable', undefined, { message: `Unknown archived workspace: ${id}.` })
      host.assertRestoreCapacity(saved.name, id)
      if (host.tabs().length + saved.tabs.length > host.maxTabs) throw new LocalizedError('appErrors.workspace.restoreTabLimit', { name: saved.name, max: host.maxTabs })
      const now = new Date().toISOString()
      const restored: ActiveWorkspace = { ...this.publicFields(saved), createdAt: now, lastUsedAt: now, activeTabId: null,
        storageId: saved.storageId, origins: [...saved.origins], navigationAudit: [...saved.navigationAudit] }
      if (placement?.pinnedAt) restored.pinnedAt = placement.pinnedAt
      // Until its tabs are open, the archive keeps its place for a rollback.
      this.archived.delete(id); this.reservedArchivePlaces++
      if (placement) {
        // The open workspaces are kept in their tab rail order. A workspace before it may have closed meanwhile, so
        // its place is found from its neighbours first.
        const open = [...this.active]
        const after = open.findIndex(([key]) => key === placement.after)
        const before = open.findIndex(([key]) => key === placement.before)
        open.splice(after >= 0 ? after + 1 : before >= 0 ? before : Math.min(placement.index, open.length), 0, [id, restored])
        this.active.clear()
        for (const [key, value] of open) this.active.set(key, value)
      } else this.active.set(id, restored)
      try {
        return await host.withActiveOperation(id, 'restoring the archived workspace', async () => {
          try {
            // The tab shown loads at once, in the window or for the agent that opened the workspace; the others load in
            // their turn, a few at a time.
            const shownIndex = saved.shownTabIndex !== undefined && saved.shownTabIndex < saved.tabs.length ? saved.shownTabIndex : saved.tabs.length - 1
            for (const [index, tab] of saved.tabs.entries()) {
              await host.createTab({ label: tab.label, title: tab.title, url: tab.url, pinned: tab.pinned, zoomIsolated: tab.zoomIsolated === true,
                defaultFontSize: tab.defaultFontSize, muted: tab.muted === true, tabAgentPaused: tab.tabAgentPaused === true,
                humanInteractionLocked: tab.humanInteractionLocked === true, mcpGroupId: id, allowBusyWorkspace: true, active: false,
                loadsInTurn: index !== shownIndex })
            }
            // The tabs open in the order they were saved, so the tab shown when it was archived is shown again.
            const tabs = host.tabs().filter(tab => tab.mcpGroupId === id)
            const shown = tabs[shownIndex] ?? tabs[tabs.length - 1]
            if (shown && show) host.selectTab(shown.id)
            else if (shown) restored.activeTabId = shown.id
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
