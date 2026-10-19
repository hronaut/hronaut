import type { IpcMain } from 'electron'
import type { BrowserTabsManager } from './browser/tabs-manager.js'

interface FixedDateIpcHost {
  ipcMain: Pick<IpcMain, 'on'>
  tabs(): Pick<BrowserTabsManager, 'fixedDateBootstrap'> | null
}

/**
 * Answers the page preload of each new top-level HTTP(S) document, before its
 * scripts run, with the fixed Date staged for its tab and origin. Embedded
 * frames are never answered with one.
 */
export function registerFixedDateIpc(host: FixedDateIpcHost): void {
  host.ipcMain.on('fixed-date:bootstrap', event => {
    const tabs = host.tabs()
    event.returnValue = tabs && event.senderFrame && event.senderFrame === event.sender.mainFrame
      ? tabs.fixedDateBootstrap(event.sender, event.senderFrame.origin)
      : { enabled: false }
  })
}
