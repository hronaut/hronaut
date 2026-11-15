import type { IpcMainInvokeEvent } from 'electron'
import type { TypedIpcMain } from './typed-ipc.js'
import { parseNetworkRouteInput } from './browser/network-route-input.js'
import type { Browser } from './browser/browser.js'
import { addNetworkRoute, clearNetworkRoutes, moveNetworkRoute, networkRoutes, removeNetworkRoute, setNetworkRouteEnabled } from './browser/network-conditions/network-conditions.js'
import { browserState } from './browser/browser-state/browser-state.js'
import { NETWORK_ROUTES_IPC } from '../shared/ipc/network-routes.js'

interface NetworkRoutesIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc: TypedIpcMain['handle']
  tabs(): Browser | null
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerNetworkRoutesIpc(host: NetworkRoutesIpcHost): void {
  host.handleBrowserIpc(NETWORK_ROUTES_IPC.list, (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    return networkRoutes(host.tabs()!, tabId)
  })
  host.handleBrowserIpc(NETWORK_ROUTES_IPC.add, async (event, tabId: unknown, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    const input = parseNetworkRouteInput(value)
    // Only agents can release a held request, so the Network panel cannot create one.
    if (input.holdUntilReleased !== undefined || input.holdSeconds !== undefined) throw new TypeError('Held mock responses are available to agents only')
    return addNetworkRoute(host.tabs()!, tabId, input)
  })
  host.handleBrowserIpc(NETWORK_ROUTES_IPC.remove, async (event, tabId: unknown, routeId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof routeId !== 'string') throw new TypeError('Invalid network route')
    return removeNetworkRoute(host.tabs()!, tabId, routeId)
  })
  host.handleBrowserIpc(NETWORK_ROUTES_IPC.setEnabled, (event, tabId: unknown, routeId: unknown, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string' || typeof routeId !== 'string' || typeof enabled !== 'boolean') throw new TypeError('Invalid network route enabled state')
    return setNetworkRouteEnabled(host.tabs()!, tabId, routeId, enabled)
  })
  host.handleBrowserIpc(NETWORK_ROUTES_IPC.move, (event, tabId: unknown, routeId: unknown, direction: unknown) => {
    host.assertTrustedSender(event)
    if (
      typeof tabId !== 'string'
      || typeof routeId !== 'string'
      || (direction !== 'up' && direction !== 'down')
    ) throw new TypeError('Invalid network route move')
    return moveNetworkRoute(host.tabs()!, tabId, routeId, direction)
  })
  host.handleBrowserIpc(NETWORK_ROUTES_IPC.clear, async (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    await clearNetworkRoutes(host.tabs()!, tabId)
    return browserState(host.tabs()!)
  })
}
