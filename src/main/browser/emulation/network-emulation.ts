import type { WebContents } from 'electron'
import type { BrowserEmulationState } from '../../../shared/types.js'
import type { BrowserNetworkRouteRecord } from '../network-conditions/network-conditions.js'

// A copy of the tab manager's own check, which its other debugger features keep using.
function isUnavailableCdpMethod(error: unknown): boolean {
  return /(?:method not found|wasn't found|-32601)/i.test(String(error))
}

/** The network presets, as Chromium network conditions. */
const NETWORK_EMULATION = {
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  'slow-3g': {
    offline: false,
    latency: 400 * 5,
    downloadThroughput: 500 * 1000 / 8 * 0.8,
    uploadThroughput: 500 * 1000 / 8 * 0.8,
    connectionType: 'cellular3g'
  },
  'slow-4g': {
    offline: false,
    latency: 150 * 3.75,
    downloadThroughput: 1.6 * 1000 * 1000 / 8 * 0.9,
    uploadThroughput: 750 * 1000 / 8 * 0.9,
    connectionType: 'cellular4g'
  },
  'fast-4g': {
    offline: false,
    latency: 60 * 2.75,
    downloadThroughput: 9 * 1000 * 1000 / 8 * 0.9,
    uploadThroughput: 1.5 * 1000 * 1000 / 8 * 0.9,
    connectionType: 'cellular4g'
  }
} as const

/**
 * Applies the network preset and the enabled request rules' throttling to the
 * page through the debugger, with send when given. A Chromium build without
 * rule-based conditions falls back to whole-page conditions unless a rule
 * throttles individual requests or send was given.
 */
export async function applyNetworkEmulation(
  webContents: WebContents,
  preset: BrowserEmulationState['network'],
  routes: BrowserNetworkRouteRecord[] = [],
  send?: (method: string, params?: Record<string, unknown>) => Promise<unknown>
): Promise<void> {
  const command = send ?? ((method: string, params?: Record<string, unknown>) => webContents.debugger.sendCommand(method, params))
  const conditions = NETWORK_EMULATION[preset]
  routes = routes.filter(route => route.enabled)
  const hasIndividualThrottle = routes.some((route) => route.behavior === 'throttle')
  const routeConditions: Array<{
    urlPattern: string
    offline: boolean
    latency: number
    downloadThroughput: number
    uploadThroughput: number
    connectionType?: string
  }> = []
  if (hasIndividualThrottle) {
    for (const route of routes) {
      if (route.behavior === 'throttle' && route.throttle) {
        routeConditions.push({ urlPattern: route.urlPattern, ...NETWORK_EMULATION[route.throttle] })
      } else if (!route.method) {
        // Method-specific Fetch rules cannot be represented in a URL-only
        // network condition, but they still win when fulfilled or failed.
        routeConditions.push({ urlPattern: route.urlPattern, ...NETWORK_EMULATION.none })
      }
    }
  }
  try {
    await command('Network.emulateNetworkConditionsByRule', {
      offline: conditions.offline,
      emulateOfflineServiceWorker: conditions.offline,
      matchedNetworkConditions: [
        ...routeConditions,
        ...(preset === 'none' ? [] : [{ urlPattern: '', ...conditions }])
      ]
    })
    await command('Network.overrideNetworkState', conditions)
  } catch (error) {
    if (send || !isUnavailableCdpMethod(error)) throw error
    if (hasIndividualThrottle) {
      throw new Error('Individual request throttling is unavailable in this Chromium build')
    }
    await command('Network.emulateNetworkConditions', conditions)
  }
}
