import type { MenuItemConstructorOptions } from 'electron'
import type { ActiveWorkspace } from '../workspace-registry.js'
import type { Browser } from '../browser.js'
import { sleepBlockReason, sleepWorkspaceTabs } from '../tab-sleep/tab-sleep.js'

/**
 * The workspace's context menu items: a new tab in it, importing browser
 * cookies, editing, pinning, sleeping its tabs and archiving it. New tab asks
 * the window to open the tab, and the window reports its own failures; any
 * other failed action is logged and reported to the manager's onActionFailed
 * option.
 */
export function workspaceContextMenuItems(browser: Browser, group: ActiveWorkspace): MenuItemConstructorOptions[] {
  const reportError = (action: string) => (error: unknown): void => {
    console.error(`[browser] Could not ${action} from workspace context menu:`, error)
    browser.options.onActionFailed?.(action, error)
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
      label: browser.text('native.context.newTabWorkspace'),
      // The window opens it as its + button does, so the cursor goes to the address field.
      click: () => runAction('open a new tab in the workspace', () => browser.window.webContents.send('browser:new-tab-requested', group.id))
    },
    { type: 'separator' },
    {
      id: 'import-browser-cookies',
      label: browser.text('browserImport.action'),
      click: () => browser.window.webContents.send('browser:home-workspace-editor', { view: 'import', workspaceId: group.id })
    },
    {
      id: 'edit-workspace',
      label: browser.text('native.context.editWorkspace'),
      click: () => runAction('edit the workspace', () => {
        browser.window.webContents.send('browser:edit-tab-group', group.id)
      })
    },
    {
      id: 'pin-workspace',
      label: browser.text(pin ? 'native.context.pinWorkspace' : 'native.context.unpinWorkspace'),
      click: () => runAction('pin the workspace', () => browser.setWorkspacePinned(group.id, pin))
    },
    { type: 'separator' },
    {
      id: 'sleep-workspace-tabs',
      label: browser.text('native.context.sleepWorkspaceTabs'),
      enabled: !browser.allHumanInteractionLocked && [...browser.tabs.values()].some((tab) => (
        tab.mcpGroupId === group.id
        && !tab.sleeping
        && sleepBlockReason(browser, tab) === undefined
      )),
      click: () => runAction('put eligible workspace tabs to sleep', () => sleepWorkspaceTabs(browser, group.id))
    },
    {
      id: 'archive-workspace',
      label: browser.text('native.context.archiveWorkspace'),
      enabled: !browser.allHumanInteractionLocked || ![...browser.tabs.values()].some(tab => tab.mcpGroupId === group.id),
      click: () => runAction('archive the workspace', () => browser.archiveWorkspaceForPerson(group.id))
    }
  ]
}
