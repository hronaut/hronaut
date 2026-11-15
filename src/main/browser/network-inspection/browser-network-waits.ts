import type { BrowserTab } from '../browser-tab.js'
import { BrowserNetworkWaitController } from '../network-wait-controller.js'
import { matchingNetworkWaitRequest } from './network-request-records.js'
import { networkRequestSummary } from './network-request-summary.js'

/** Waits for a network request in a tab, matched against the requests the tab recorded. */
export function createNetworkWaitController(): BrowserNetworkWaitController<BrowserTab> {
  return new BrowserNetworkWaitController<BrowserTab>({
    matchingRequest: (tab, options, minCaptureSequence) => {
      const request = matchingNetworkWaitRequest(tab, options, minCaptureSequence)
      return request ? networkRequestSummary(request) : undefined
    }
  })
}
