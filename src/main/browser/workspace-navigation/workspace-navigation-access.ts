import type { WebContents } from 'electron'
import type { BrowserState, BrowserWorkspaceNavigationAuditSource } from '../../../shared/types.js'
import type { WorkspaceNavigationDecision } from '../workspace-navigation-policy.js'
import type { ActiveWorkspace, ArchivedWorkspace } from '../workspace-registry.js'

/** The tab fields the workspace navigation policy reads when the policy changes. */
export interface WorkspaceNavigationTab {
  url: string
  mcpGroupId?: string
  webContents: WebContents
}

/** The workspace fields the navigation policy reads and writes: the policy itself and its audit of denials. */
export type WorkspaceNavigationWorkspace = Pick<ActiveWorkspace, 'contextClass' | 'lastUsedAt' | 'navigationPolicy' | 'navigationAudit'>

/** The tab manager option that hears every navigation decision, allowed or not. */
export interface WorkspaceNavigationOptions {
  onWorkspaceNavigationDecision?: (workspaceId: string, decision: WorkspaceNavigationDecision, source: BrowserWorkspaceNavigationAuditSource) => void
}

/**
 * What the workspace navigation policy needs from the tab manager, which
 * keeps the tabs, the active and archived workspaces, their busy state and
 * inspection permissions, its options and state publication private. The
 * workspace is the registry's own record, so a policy change and a recorded
 * denial land on it, and its identity keys the inspection permission.
 */
export interface WorkspaceNavigationAccess<Tab extends WorkspaceNavigationTab> {
  findWorkspace(workspaceId: string): WorkspaceNavigationWorkspace | undefined
  findArchivedWorkspace(workspaceId: string): Pick<ArchivedWorkspace, 'navigationAudit'> | undefined
  assertWorkspaceIdle(workspaceId: string): void
  inspectionPermission(workspace: object): number | undefined
  setInspectionPermission(workspace: object, generation: number): void
  tabs(): IterableIterator<Tab>
  options(): WorkspaceNavigationOptions
  prepareDiagnosticNavigation(tab: Tab): void
  changed(persist?: boolean): void
  getState(): BrowserState
}
