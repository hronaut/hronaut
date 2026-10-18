import type {
  BrowserState,
  BrowserTabGroupState,
  BrowserWorkspaceContextClass,
  BrowserWorkspaceNavigationPolicy
} from '../../../shared/types.js'
import type { BrowserTabGroupColor } from '../../../shared/tab-groups.js'
import type { WorkspaceTemplateImporter } from '../workspace-template-import.js'
import type { ActiveWorkspace, ArchivedWorkspace } from '../workspace-registry.js'

/** What creating a workspace passes when it opens a tab: a blank page or a template's start page in that workspace. */
export interface WorkspaceCreationTabOptions {
  url: string
  active: boolean
  focus?: boolean
  mcpGroupId: string
}

/**
 * What creating workspaces for the person needs from the tab manager, which
 * keeps the tabs, the active tab, the open and archived workspaces, the
 * template importer, workspace creation, changes and closing, tab creation,
 * selection and state publication private. The workspace maps are the
 * workspace registry's own; the template importer stays a manager field so
 * one importer serves every template, and it is set through its setter the
 * first time a template is imported.
 */
export interface WorkspaceCreationAccess {
  /** The tab the window shows. */
  activeTabId(): string | null
  /** Every open tab by id. */
  tabs(): ReadonlyMap<string, { mcpGroupId?: string }>
  /** The open workspaces by id, which a new default workspace joins. */
  mcpTabGroups(): Map<string, ActiveWorkspace>
  /** The archived workspaces by id, whose names a new workspace's name avoids. */
  savedTabGroups(): ReadonlyMap<string, ArchivedWorkspace>
  /** Throws when Hronaut already keeps as many open workspaces as it can. */
  assertActiveWorkspaceCapacity(): void
  /** Creates an open workspace, empty or copied from another one. */
  createMcpTabGroup(
    name: string,
    color?: BrowserTabGroupColor,
    storage?: 'scratch' | 'fork-workspace',
    origins?: string[],
    allowDuplicateName?: boolean,
    navigationPolicy?: BrowserWorkspaceNavigationPolicy,
    sourceWorkspaceId?: string,
    description?: string,
    contextClass?: BrowserWorkspaceContextClass
  ): Promise<BrowserTabGroupState>
  /** Changes an open workspace's agent access, sidebar visibility or deletion protection. */
  updateMcpTabGroup(groupId: string, updates: { agentAccess?: boolean; hiddenFromSidebar?: boolean; deletionProtected?: boolean }): BrowserTabGroupState
  /** Closes an open workspace and deletes its tabs and data. */
  closeMcpTabGroup(groupId: string): Promise<BrowserTabGroupState[]>
  /** Opens a tab. */
  createTab(options: WorkspaceCreationTabOptions): Promise<unknown>
  /** Shows a tab. */
  selectTab(tabId: string): BrowserState
  /** The browser state. */
  getState(): BrowserState
  /** The importer that creates workspaces from templates, once one was needed. */
  workspaceTemplateImporter(): WorkspaceTemplateImporter | undefined
  /** Keeps the importer that creates workspaces from templates. */
  setWorkspaceTemplateImporter(importer: WorkspaceTemplateImporter): void
}
