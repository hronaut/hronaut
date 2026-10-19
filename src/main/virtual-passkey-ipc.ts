import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { BrowserTabsManager } from './browser/tabs-manager.js'

interface VirtualPasskeyIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): Pick<BrowserTabsManager, 'stopVirtualPasskey'> | null
}

/** The address bar's stop for an agent's virtual passkey. Dependencies stay lazy because handlers are registered before the window loads. */
export function registerVirtualPasskeyIpc(host: VirtualPasskeyIpcHost): void {
  host.handleBrowserIpc('browser:stop-virtual-passkey', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid virtual passkey tab')
    return host.tabs()!.stopVirtualPasskey(tabId)
  })
}
