import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import { isBrowserEnvironmentSettings } from '../shared/browser-environment.js'
import type { BrowserEnvironmentSettings, BrowserViewportEmulation } from '../shared/types.js'
import { isBrowserViewportEmulation } from '../shared/viewport-presets.js'

interface EmulationIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): Pick<BrowserTabsManager, 'clearCssStatePreview' | 'emulate' | 'getState'> | null
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerEmulationIpc(host: EmulationIpcHost): void {
  host.handleBrowserIpc('browser:clear-css-state-preview', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid CSS state preview tab')
    return host.tabs()!.clearCssStatePreview(tabId)
  })
  host.handleBrowserIpc('browser:set-tab-viewport', async (event, tabId: unknown, viewport: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    if (viewport !== null && !isBrowserViewportEmulation(viewport)) throw new TypeError('Invalid viewport emulation')
    const normalizedViewport: BrowserViewportEmulation | null = viewport === null ? null : {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      mobile: viewport.mobile,
      touch: viewport.touch,
      orientation: viewport.orientation
    }
    await host.tabs()!.emulate({ tabId, viewport: normalizedViewport })
    return host.tabs()!.getState()
  })
  host.handleBrowserIpc('browser:set-tab-environment', async (event, tabId: unknown, environment: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || !isBrowserEnvironmentSettings(environment)) {
      throw new TypeError('Invalid browser environment')
    }
    await host.tabs()!.emulate({ tabId, ...(environment as BrowserEnvironmentSettings) })
    return host.tabs()!.getState()
  })
  host.handleBrowserIpc('browser:reset-tab-emulation', async (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    await host.tabs()!.emulate({ tabId, reset: true })
    return host.tabs()!.getState()
  })
  host.handleBrowserIpc('browser:recover-tab-emulation', async (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    await host.tabs()!.emulate({ tabId, recover: true })
    return host.tabs()!.getState()
  })
}
