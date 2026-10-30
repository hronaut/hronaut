import { MAX_BROWSER_TABS } from '../../../shared/types.js'
import { MAX_ARCHIVED_WORKSPACES } from '../../../shared/undo.js'
import { orderedTabs } from '../browser-core.js'
import { publishChange } from '../browser-state/browser-state.js'
import type { Browser } from '../browser.js'
import { closeMcpTabGroupInternal } from '../mcp-tab-groups/close-mcp-tab-group.js'
import { requireMcpTabGroup, assertWorkspaceNameAvailable } from '../mcp-tab-groups/mcp-tab-groups.js'
import { createTab } from '../new-tabs/create-tab.js'
import { assertActiveWorkspaceCapacity } from '../workspace-creation/workspace-capacity.js'
import { withSavedWorkspaceOperation, withWorkspaceOperation } from '../workspace-operations/workspace-operations.js'
import { WorkspaceRegistry } from './workspace-registry.js'

/**
 * The browser's open and archived workspaces, within the browser's tab and archive limits, archiving, restoring
 * and closing them through the browser's workspace operations.
 */
export function createWorkspaceRegistry(browser: Browser): WorkspaceRegistry {
  return new WorkspaceRegistry({
    maxTabs: MAX_BROWSER_TABS,
    maxArchived: MAX_ARCHIVED_WORKSPACES,
    tabs: () => orderedTabs(browser),
    requireActive: id => requireMcpTabGroup(browser, id),
    assertRestoreCapacity: (name, id) => {
      assertWorkspaceNameAvailable(browser, name, undefined, id, true)
      assertActiveWorkspaceCapacity(browser)
    },
    withActiveOperation: (id, action, run) => withWorkspaceOperation(browser, id, action, run),
    withArchivedOperation: (id, action, run) => withSavedWorkspaceOperation(browser, id, action, run),
    closeActive: (id, preserve) => closeMcpTabGroupInternal(browser, id, preserve),
    createTab: tab => createTab(browser, tab),
    selectTab: id => browser.selectTab(id),
    remapDownloads: (from, to) => browser.downloadController.remapDownloadWorkspaceOwnership(from, to),
    changed: () => publishChange(browser)
  })
}
