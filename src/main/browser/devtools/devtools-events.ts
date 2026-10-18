import type { WebContents } from 'electron'
import type { DevToolsAccess, DevToolsTab } from './devtools-access.js'

/**
 * Follows the page's Developer Tools: opening them ends any CSS state preview
 * and publishes the state; closing them publishes the state and monitors the
 * page's website dialogs again.
 */
export function attachDevToolsEvents<Tab extends DevToolsTab>(access: DevToolsAccess<Tab>, tab: Tab, webContents: WebContents): void {
  webContents.on('devtools-opened', () => {
    void access.cssStatePreview().clear(tab, 'devtools-opened').catch(() => undefined)
    access.changed(false)
  })
  webContents.on('devtools-closed', () => {
    access.changed(false)
    void access.ensureDialogMonitoring(tab)
  })
}
