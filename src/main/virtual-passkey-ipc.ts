import type { IpcMainInvokeEvent } from 'electron'
import type { TypedIpcMain } from './typed-ipc.js'
import type { Browser } from './browser/browser.js'
import { stopVirtualPasskey } from './browser/virtual-passkey/browser-virtual-passkeys.js'
import { VIRTUAL_PASSKEY_IPC } from '../shared/ipc/virtual-passkey.js'

interface VirtualPasskeyIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc: TypedIpcMain['handle']
  tabs(): Browser | null
}

/** The address bar's stop for an agent's virtual passkey. Dependencies stay lazy because handlers are registered before the window loads. */
export function registerVirtualPasskeyIpc(host: VirtualPasskeyIpcHost): void {
  host.handleBrowserIpc(VIRTUAL_PASSKEY_IPC.stop, (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid virtual passkey tab')
    return stopVirtualPasskey(host.tabs()!, tabId)
  })
}
