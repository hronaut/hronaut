import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { parseNetworkRouteInput } from './browser/network-route-input.js'
import type { Browser } from './browser/browser.js'

type NetworkRoutesIpcTabs = Pick<Browser,
  | 'networkRoutes' | 'addNetworkRoute' | 'removeNetworkRoute' | 'setNetworkRouteEnabled' | 'moveNetworkRoute'
  | 'clearNetworkRoutes' | 'getState'>

interface NetworkRoutesIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): NetworkRoutesIpcTabs | null
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerNetworkRoutesIpc(host: NetworkRoutesIpcHost): void {
  host.handleBrowserIpc('browser:list-network-routes', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    return host.tabs()!.networkRoutes(tabId)
  })
  host.handleBrowserIpc('browser:add-network-route', async (event, tabId: unknown, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    const input = parseNetworkRouteInput(value)
    // Only agents can release a held request, so the Network panel cannot create one.
    if (input.holdUntilReleased !== undefined || input.holdSeconds !== undefined) throw new TypeError('Held mock responses are available to agents only')
    return host.tabs()!.addNetworkRoute(tabId, input)
  })
  host.handleBrowserIpc('browser:remove-network-route', async (event, tabId: unknown, routeId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof routeId !== 'string') throw new TypeError('Invalid network route')
    return host.tabs()!.removeNetworkRoute(tabId, routeId)
  })
  host.handleBrowserIpc('browser:set-network-route-enabled', (event, tabId: unknown, routeId: unknown, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof routeId !== 'string' || typeof enabled !== 'boolean') throw new TypeError('Invalid network route enabled state')
    return host.tabs()!.setNetworkRouteEnabled(tabId, routeId, enabled)
  })
  host.handleBrowserIpc('browser:move-network-route', (event, tabId: unknown, routeId: unknown, direction: unknown) => {
    host.assertTrustedSender(event)
    if (
      typeof tabId !== 'string'
      || typeof routeId !== 'string'
      || (direction !== 'up' && direction !== 'down')
    ) throw new TypeError('Invalid network route move')
    return host.tabs()!.moveNetworkRoute(tabId, routeId, direction)
  })
  host.handleBrowserIpc('browser:clear-network-routes', async (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    await host.tabs()!.clearNetworkRoutes(tabId)
    return host.tabs()!.getState()
  })
}
