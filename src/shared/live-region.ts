import { liveRegionInPage } from './live-region.page.js'
import { pageScript } from './page-script.js'

export const LIVE_REGION_LIMITS = {
  maxSelectorChars: 512,
  maxObservations: 100,
  maxObservationChars: 1_000,
  maxTotalChars: 50_000,
  maxNodesPerRead: 2_000,
  maxCallbacks: 10_000,
  maxDurationMs: 300_000
} as const

export type LiveRegionPageAction = 'start' | 'get' | 'stop' | 'clear'

export const LIVE_REGION_ERRORS = {
  'invalid-selector': 'The selector is not valid CSS',
  'not-found': 'No element matches the selector in the top-level document',
  'not-unique': 'The selector matches more than one element; use a selector that identifies exactly one region',
  'too-broad': 'Select one region inside the page, not the html, head or body element',
  'excluded-region': 'Form fields, editable content, frames, scripts and styles cannot be recorded'
} as const

export type LiveRegionErrorCode = keyof typeof LIVE_REGION_ERRORS

/** The isolated-world script that starts, reads, stops or clears the selected region's text recording. */
export function liveRegionPageScript(action: LiveRegionPageAction, selector?: string): string {
  return pageScript(liveRegionInPage, action, selector ?? '', LIVE_REGION_LIMITS)
}
