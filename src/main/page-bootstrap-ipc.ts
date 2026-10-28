import type { IpcMain } from 'electron'
import type { PageBootstrap } from '../shared/page-bootstrap.js'
import type { BrowserTabsManager } from './browser/tabs-manager.js'

interface PageBootstrapIpcHost {
  ipcMain: Pick<IpcMain, 'on'>
  tabs(): Pick<BrowserTabsManager, 'reactInspectionBootstrap' | 'fixedDateBootstrap'> | null
}

/**
 * Answers the page preload of each new top-level HTTP(S) document, before its
 * scripts run, with what Hronaut installs in it: React inspection when it is on
 * for the tab, and the fixed Date staged for its tab and origin. One answer
 * holds both, since the page waits for it while the main process may be busy
 * with many pages loading. Embedded frames are never answered with either.
 */
export function registerPageBootstrapIpc(host: PageBootstrapIpcHost): void {
  host.ipcMain.on('page:bootstrap', event => {
    const tabs = host.tabs()
    event.returnValue = (tabs && event.senderFrame && event.senderFrame === event.sender.mainFrame
      ? {
          reactInspection: tabs.reactInspectionBootstrap(event.sender),
          fixedDate: tabs.fixedDateBootstrap(event.sender, event.senderFrame.origin)
        }
      : { reactInspection: { enabled: false }, fixedDate: { enabled: false } }) satisfies PageBootstrap
  })
}
