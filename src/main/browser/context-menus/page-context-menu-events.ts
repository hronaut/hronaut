import type { WebContents } from 'electron'
import type { PageContextMenuAccess, PageContextMenuTab } from './page-context-menu-access.js'
import { showContextMenu } from './page-context-menu.js'

/**
 * Replaces the page's own context menu with Hronaut's on every right-click;
 * while the person's input to the tab is locked, no menu opens.
 */
export function attachPageContextMenuEvents<Tab extends PageContextMenuTab>(access: PageContextMenuAccess<Tab>, tab: Tab, webContents: WebContents): void {
  webContents.on('context-menu', (event, params) => {
    event.preventDefault()
    if (access.isHumanInteractionLocked(tab)) return
    showContextMenu(access, tab, params)
  })
}
