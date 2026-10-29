import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Browser } from '../../../browser/browser.js'
import { pageObservationSettlement } from '../page-observation-settlement.js'

/**
 * How a screenshot settles a call: as any page observation, and a tracked
 * screenshot's observation is kept only when its result is published, so a
 * cancelled or revoked call leaves the session's observations as they were.
 */
export function screenshotSettlement(manager: Browser) {
  const page = pageObservationSettlement(manager)
  let commit: (() => void) | undefined
  return {
    ...page,
    /** Holds the tracked screenshot's observation until the result is published. */
    retainObservation: (pending: () => void): void => { commit = pending },
    publish: (result: CallToolResult): CallToolResult | undefined => {
      const published = page.publish(result)
      const pending = commit
      commit = undefined
      if (published === result) pending?.()
      return published
    },
    dispose: (): void => { commit = undefined }
  }
}

export type ScreenshotSettlement = ReturnType<typeof screenshotSettlement>
