import { networkRequestMatchesWait, type NormalizedBrowserNetworkWaitOptions } from '../../../shared/network-wait.js'
import type { BrowserNetworkRequestRecord } from '../network-recording.js'

/** The tab fields holding its recorded requests and its current observation generation. */
export interface NetworkRequestRecordsTab {
  networkRequests: BrowserNetworkRequestRecord[]
  observationGeneration: number
}

/** The tab's recorded requests of its current observation generation, oldest first. */
export function currentNetworkRequests(tab: NetworkRequestRecordsTab): BrowserNetworkRequestRecord[] {
  return tab.networkRequests.filter(request => request.observationGeneration === tab.observationGeneration)
}

/**
 * The newest request of the tab's current observation generation captured
 * after minCaptureSequence that matches the network wait.
 */
export function matchingNetworkWaitRequest(
  tab: NetworkRequestRecordsTab,
  options: NormalizedBrowserNetworkWaitOptions,
  minCaptureSequence: number
): BrowserNetworkRequestRecord | undefined {
  return [...tab.networkRequests].reverse().find((request) => (
    request.observationGeneration === tab.observationGeneration
    && request.captureSequence > minCaptureSequence && networkRequestMatchesWait(request, options)
  ))
}
