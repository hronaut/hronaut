import { NETWORK_ROUTES_IPC } from '../../shared/ipc/network-routes.js'
import type { HronautNetworkRoutesApi } from '../../shared/types.js'
import { invoke } from './ipc.js'

/** window.hronaut's Network panel routes for a tab's requests. */
export const networkRoutesApi: HronautNetworkRoutesApi = {
  listNetworkRoutes: (tabId) => invoke(NETWORK_ROUTES_IPC.list, tabId),
  addNetworkRoute: (tabId, input) => invoke(NETWORK_ROUTES_IPC.add, tabId, input),
  setNetworkRouteEnabled: (tabId, routeId, enabled) => invoke(NETWORK_ROUTES_IPC.setEnabled, tabId, routeId, enabled),
  moveNetworkRoute: (tabId, routeId, direction) => invoke(NETWORK_ROUTES_IPC.move, tabId, routeId, direction),
  removeNetworkRoute: (tabId, routeId) => invoke(NETWORK_ROUTES_IPC.remove, tabId, routeId),
  clearNetworkRoutes: (tabId) => invoke(NETWORK_ROUTES_IPC.clear, tabId)
}
