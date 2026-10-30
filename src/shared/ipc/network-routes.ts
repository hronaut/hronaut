import type {
  BrowserNetworkRouteInput,
  BrowserNetworkRouteMoveDirection,
  BrowserNetworkRouteSummary,
  BrowserState
} from '../types.js'
import type { InvokeChannel } from './channel.js'

/** The Network panel's routes for a tab's requests; each change answers the tab's routes after it. */
export const NETWORK_ROUTES_IPC = {
  /** Shell → main: the tab's routes, in the order they match. */
  list: 'browser:list-network-routes' as InvokeChannel<[tabId: string], BrowserNetworkRouteSummary[]>,
  /** Shell → main: adds a route; one that holds requests until released is for agents only. */
  add: 'browser:add-network-route' as InvokeChannel<[tabId: string, input: BrowserNetworkRouteInput], BrowserNetworkRouteSummary[]>,
  /** Shell → main: turns the route on or off. */
  setEnabled: 'browser:set-network-route-enabled' as InvokeChannel<[tabId: string, routeId: string, enabled: boolean], BrowserNetworkRouteSummary[]>,
  /** Shell → main: moves the route one place up or down. */
  move: 'browser:move-network-route' as InvokeChannel<[tabId: string, routeId: string, direction: BrowserNetworkRouteMoveDirection], BrowserNetworkRouteSummary[]>,
  /** Shell → main: removes the route. */
  remove: 'browser:remove-network-route' as InvokeChannel<[tabId: string, routeId: string], BrowserNetworkRouteSummary[]>,
  /** Shell → main: removes all of the tab's routes, and answers the browser state after. */
  clear: 'browser:clear-network-routes' as InvokeChannel<[tabId: string], BrowserState>
} as const
