import { MAX_BROWSER_TABS, type BrowserState, type BrowserWorkspaceCreateOptions } from '../../../shared/types.js'
import type { WorkspaceTemplateImportResult } from '../../../shared/workspace-template.js'
import { LocalizedError } from '../../localized-error.js'
import { RetainedBrowserWorkspaceError } from '../workspace-errors.js'
import { WorkspaceTemplateImporter } from '../workspace-template-import.js'
import type { Browser } from '../browser.js'
import { openWorkspaceRoom } from './workspace-capacity.js'
import { browserState } from '../browser-state/browser-state.js'

/**
 * Creates the workspaces a template describes, each without agent access
 * and with its start pages open in the background, using one importer for
 * every template.
 */
export async function importWorkspaceTemplate(browser: Browser, text: string): Promise<WorkspaceTemplateImportResult> {
  browser.workspaceTemplateImporter ??= new WorkspaceTemplateImporter({
    existingWorkspaces: () => [...browser.mcpTabGroups.values(), ...browser.savedTabGroups.values()]
      .map(({ id, name }) => ({ id, name })),
    room: () => ({ tabs: MAX_BROWSER_TABS - browser.tabs.size, workspaces: openWorkspaceRoom(browser) }),
    create: async (entry) => {
      const workspace = await browser.createMcpTabGroup(entry.name, entry.color, 'scratch', undefined, false, undefined, undefined, entry.description)
      browser.updateMcpTabGroup(workspace.id, { agentAccess: false })
      return workspace.id
    },
    openStartPages: async (workspaceId, urls) => {
      // A template can open many pages at once; they load a few at a time.
      for (const url of urls) {
        await browser.createTab({ url, active: false, focus: false, mcpGroupId: workspaceId, loadsInTurn: true })
      }
    },
    remove: async (workspaceId) => { await browser.closeMcpTabGroup(workspaceId) }
  })
  return browser.workspaceTemplateImporter.import(text)
}

/**
 * Creates a workspace from the workspace editor and shows its first tab,
 * opening a blank one when it has none. When that fails the workspace is
 * closed again; when closing fails too, it stays listed so its isolated data
 * can be deleted.
 */
export async function createWorkspace(browser: Browser, options: BrowserWorkspaceCreateOptions): Promise<BrowserState> {
  if (!options.name.trim()) throw new LocalizedError('appErrors.workspace.nameEmpty')
  const workspace = await browser.createMcpTabGroup(
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
  if (options.agentAccess !== undefined) browser.updateMcpTabGroup(workspace.id, { agentAccess: options.agentAccess })
  try {
    if (workspace.activeTabId) browser.selectTab(workspace.activeTabId)
    else await browser.createTab({ url: 'about:blank', active: true, mcpGroupId: workspace.id })
    browser.updateMcpTabGroup(workspace.id, { hiddenFromSidebar: options.hiddenFromSidebar === true, deletionProtected: options.deletionProtected === true })
    return browserState(browser)
  } catch (error) {
    try {
      await browser.closeMcpTabGroup(workspace.id)
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
