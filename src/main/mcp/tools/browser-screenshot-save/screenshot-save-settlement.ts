import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { PendingScreenshotExport } from '../../../browser/screenshot-export/screenshot-export.js'
import { textResult } from '../../tool-results.js'
import type { ToolActivityClassification } from '../tool-context.js'

/** A screenshot written to downloads whose call lost its authority before it was confirmed: where it went is withheld. */
export function screenshotSavedUnconfirmedResult(): CallToolResult {
  const outcome = {
    status: 'SAVED_UNCONFIRMED',
    reason: 'SCREENSHOT_PUBLICATION_REVOKED',
    dispatch: 'dispatched',
    effects: 'file-written',
    retrySafe: false,
    nextAction: 'A screenshot file was written to the downloads folder, but this call lost its authority before confirming it, so its name and location are withheld. Inspect the page again before saving another; do not save again automatically.'
  }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

/**
 * Holds the saved screenshot until the call settles: its name and location are published only if the call still has
 * its authority then. Once the file is written, every failure says a file was saved, without saying where, so the
 * agent never takes it for nothing having happened, and never learns more after the person withdrew its access.
 */
export function screenshotExportSettlement() {
  let pending: PendingScreenshotExport | undefined
  const unconfirmed = (): CallToolResult | undefined => pending ? screenshotSavedUnconfirmedResult() : undefined
  return {
    retain: (exported: PendingScreenshotExport): void => { pending = exported },
    effectsPossible: (): boolean => pending !== undefined,
    classifyActivity: (activity: ToolActivityClassification): ToolActivityClassification => ({ ...activity, dispatched: pending !== undefined }),
    publicationRevoked: (): CallToolResult | undefined => unconfirmed(),
    publish: (result: CallToolResult): CallToolResult | undefined => {
      if (result.isError) return unconfirmed()
      if (!pending) throw new Error('Screenshot export publication guard is unavailable')
      try {
        pending.assertAuthority()
      } catch {
        return screenshotSavedUnconfirmedResult()
      }
      return result // No await after the final cancellation/authority check.
    },
    settleError: (): CallToolResult | undefined => unconfirmed()
  }
}

export type ScreenshotExportSettlement = ReturnType<typeof screenshotExportSettlement>
