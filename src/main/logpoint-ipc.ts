import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { BrowserTabsManager } from './browser/tabs-manager.js'

interface LogpointIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): Pick<BrowserTabsManager, 'stopLogpoints'> | null
}

/** The address bar's stop for an agent's logpoints. Dependencies stay lazy because handlers are registered before the window loads. */
export function registerLogpointIpc(host: LogpointIpcHost): void {
  host.handleBrowserIpc('browser:stop-logpoints', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid logpoint tab')
    return host.tabs()!.stopLogpoints(tabId)
  })
}
