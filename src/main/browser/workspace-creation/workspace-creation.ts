import { MAX_BROWSER_TABS, type BrowserState, type BrowserWorkspaceCreateOptions } from '../../../shared/types.js'
import type { WorkspaceTemplateImportResult } from '../../../shared/workspace-template.js'
import { LocalizedError } from '../../localized-error.js'
import { RetainedBrowserWorkspaceError } from '../workspace-errors.js'
import { WorkspaceTemplateImporter } from '../workspace-template-import.js'
import type { WorkspaceCreationAccess } from './workspace-creation-access.js'

/**
 * Creates the workspaces a template describes, each without agent access
 * and with its start pages open in the background, using one importer for
 * every template.
 */
export async function importWorkspaceTemplate(access: WorkspaceCreationAccess, text: string): Promise<WorkspaceTemplateImportResult> {
  access.setWorkspaceTemplateImporter(access.workspaceTemplateImporter() ?? new WorkspaceTemplateImporter({
    existingWorkspaces: () => [...access.mcpTabGroups().values(), ...access.savedTabGroups().values()]
      .map(({ id, name }) => ({ id, name })),
    room: () => ({ tabs: MAX_BROWSER_TABS - access.tabs().size, workspaces: access.openWorkspaceRoom() }),
    create: async (entry) => {
      const workspace = await access.createMcpTabGroup(entry.name, entry.color, 'scratch', undefined, false, undefined, undefined, entry.description)
      access.updateMcpTabGroup(workspace.id, { agentAccess: false })
      return workspace.id
    },
    openStartPages: async (workspaceId, urls) => {
      for (const url of urls.length ? urls : ['about:blank']) {
        await access.createTab({ url, active: false, focus: false, mcpGroupId: workspaceId })
      }
    },
    remove: async (workspaceId) => { await access.closeMcpTabGroup(workspaceId) }
  }))
  return access.workspaceTemplateImporter()!.import(text)
}

/**
 * Creates a workspace from the workspace editor and shows its first tab,
 * opening a blank one when it has none. When that fails the workspace is
 * closed again; when closing fails too, it stays listed so its isolated data
 * can be deleted.
 */
export async function createWorkspace(access: WorkspaceCreationAccess, options: BrowserWorkspaceCreateOptions): Promise<BrowserState> {
  if (!options.name.trim()) throw new LocalizedError('appErrors.workspace.nameEmpty')
  const workspace = await access.createMcpTabGroup(
    options.name,
    options.color,
    options.storage,
    options.origins,
    false,
    options.navigationPolicy,
    options.sourceWorkspaceId,
    options.description,
    options.contextClass
  )
  if (options.agentAccess !== undefined) access.updateMcpTabGroup(workspace.id, { agentAccess: options.agentAccess })
  try {
    if (workspace.activeTabId) access.selectTab(workspace.activeTabId)
    else await access.createTab({ url: 'about:blank', active: true, mcpGroupId: workspace.id })
    access.updateMcpTabGroup(workspace.id, { hiddenFromSidebar: options.hiddenFromSidebar === true, deletionProtected: options.deletionProtected === true })
    return access.getState()
  } catch (error) {
    try {
      await access.closeMcpTabGroup(workspace.id)
    } catch (cleanupError) {
      throw new RetainedBrowserWorkspaceError(
        [error, cleanupError],
        workspace.id,
        `Workspace ${workspace.id} could not be created or cleaned up. It remains listed so its isolated data can be deleted safely.`
      )
    }
    throw error
  }
}
