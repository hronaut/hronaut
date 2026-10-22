import type { MenuItemConstructorOptions } from 'electron'
import type { ActiveWorkspace } from '../workspace-registry.js'
import type { WorkspaceContextMenuAccess, WorkspaceContextMenuTab } from './workspace-context-menu-access.js'

/**
 * The workspace's context menu items: a new tab in it, importing browser
 * cookies, editing, pinning, sleeping its tabs and archiving it. New tab asks
 * the window to open the tab, and the window reports its own failures; any
 * other failed action is logged and reported to the manager's onActionFailed
 * option.
 */
export function workspaceContextMenuItems<Tab extends WorkspaceContextMenuTab>(access: WorkspaceContextMenuAccess<Tab>, group: ActiveWorkspace): MenuItemConstructorOptions[] {
  const reportError = (action: string) => (error: unknown): void => {
    console.error(`[browser] Could not ${action} from workspace context menu:`, error)
    access.options().onActionFailed?.(action, error)
  }
  const runAction = (action: string, callback: () => unknown): void => {
    try {
      void Promise.resolve(callback()).catch(reportError(action))
    } catch (error) {
      reportError(action)(error)
    }
  }
  // The menu does what its label said when it opened.
  const pin = group.pinnedAt === undefined
  return [
    {
      id: 'new-tab-in-workspace',
      label: access.text('native.context.newTabWorkspace'),
      // The window opens it as its + button does, so the cursor goes to the address field.
      click: () => runAction('open a new tab in the workspace', () => access.window().webContents.send('browser:new-tab-requested', group.id))
    },
    { type: 'separator' },
    {
      id: 'import-browser-cookies',
      label: access.text('browserImport.action'),
      click: () => access.window().webContents.send('browser:home-workspace-editor', { view: 'import', workspaceId: group.id })
    },
    {
      id: 'edit-workspace',
      label: access.text('native.context.editWorkspace'),
      click: () => runAction('edit the workspace', () => {
        access.window().webContents.send('browser:edit-tab-group', group.id)
      })
    },
    {
      id: 'pin-workspace',
      label: access.text(pin ? 'native.context.pinWorkspace' : 'native.context.unpinWorkspace'),
      click: () => runAction('pin the workspace', () => access.setWorkspacePinned(group.id, pin))
    },
    { type: 'separator' },
    {
      id: 'sleep-workspace-tabs',
      label: access.text('native.context.sleepWorkspaceTabs'),
      enabled: !access.allHumanInteractionLocked() && [...access.tabs()].some((tab) => (
        tab.mcpGroupId === group.id
        && !tab.sleeping
        && access.sleepBlockReason(tab) === undefined
      )),
      click: () => runAction('put eligible workspace tabs to sleep', () => access.sleepWorkspaceTabs(group.id))
    },
    {
      id: 'archive-workspace',
      label: access.text('native.context.archiveWorkspace'),
      enabled: !access.allHumanInteractionLocked() || ![...access.tabs()].some(tab => tab.mcpGroupId === group.id),
      click: () => runAction('archive the workspace', () => access.archiveWorkspaceForPerson(group.id))
    }
  ]
}
