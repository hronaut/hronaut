import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { Browser } from './browser/browser.js'
import { isBrowserEnvironmentSettings } from '../shared/browser-environment.js'
import type { BrowserEnvironmentSettings, BrowserViewportEmulation } from '../shared/types.js'
import { isBrowserViewportEmulation } from '../shared/viewport-presets.js'
import { emulate } from './browser/emulation/emulation.js'
import { browserState } from './browser/browser-state/browser-state.js'
import { clearCssStatePreview } from './browser/css-state-preview/browser-css-state-preview.js'
import { EMULATION_IPC } from '../shared/ipc/emulation.js'

interface EmulationIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): Browser | null
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerEmulationIpc(host: EmulationIpcHost): void {
  host.handleBrowserIpc(EMULATION_IPC.clearCssStatePreview, (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid CSS state preview tab')
    return clearCssStatePreview(host.tabs()!, tabId)
  })
  host.handleBrowserIpc(EMULATION_IPC.setViewport, async (event, tabId: unknown, viewport: unknown) => {
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
    await emulate(host.tabs()!, { tabId, viewport: normalizedViewport })
    return browserState(host.tabs()!)
  })
  host.handleBrowserIpc(EMULATION_IPC.setEnvironment, async (event, tabId: unknown, environment: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || !isBrowserEnvironmentSettings(environment)) {
      throw new TypeError('Invalid browser environment')
    }
    await emulate(host.tabs()!, { tabId, ...(environment as BrowserEnvironmentSettings) })
    return browserState(host.tabs()!)
  })
  host.handleBrowserIpc(EMULATION_IPC.reset, async (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    await emulate(host.tabs()!, { tabId, reset: true })
    return browserState(host.tabs()!)
  })
  host.handleBrowserIpc(EMULATION_IPC.recover, async (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    await emulate(host.tabs()!, { tabId, recover: true })
    return browserState(host.tabs()!)
  })
}
