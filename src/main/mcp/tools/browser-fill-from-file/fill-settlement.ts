import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ToolActivityClassification } from '../tool-context.js'

/**
 * How a fill from a text file settles in the tab's activity: an UNCONFIRMED
 * result follows a write whose effect Hronaut could not see, so its outcome
 * is unknown rather than a success.
 */
export function fillSettlement() {
  return {
    classifyActivity: (activity: ToolActivityClassification, _failed: boolean, result: CallToolResult | undefined): ToolActivityClassification =>
      result?.structuredContent?.status === 'UNCONFIRMED' ? { ...activity, invalidatedOutcome: 'outcome-unknown' } : activity
  }
}

export type FillSettlement = ReturnType<typeof fillSettlement>
