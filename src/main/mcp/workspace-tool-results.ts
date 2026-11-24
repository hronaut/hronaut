import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../shared/types.js'
import { mcpWorkspaceState, type PublicBrowserReconciliation } from './tool-results.js'

// How the workspace wrapper (workspace-tool-call.ts) rewrites a tool's result before it reaches the agent.

/** The result with any browser state in it replaced by the workspace's own state. */
export function scopeBrowserStateResult(result: CallToolResult, state: BrowserState, omitUrlDetail: boolean): CallToolResult {
  if (result.isError) return result
  return {
    ...result,
    content: result.content.map((item) => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as Record<string, unknown>
        if (!Array.isArray(value.tabs) || typeof value.profilePath !== 'string') return item
        // The workspace's own state leaves out another workspace's split views and Follow, so the global copies must
        // not survive underneath it.
        const {
          tabs: _tabs, closedTabs: _closedTabs, mcpTabGroups: _groups, savedTabGroups: _savedGroups, splitView: _splitView,
          restingSplitViews: _restingSplitViews, agentFollow: _agentFollow, ...valueRest
        } = value
        return { ...item, text: JSON.stringify({ ...valueRest, ...mcpWorkspaceState(state, omitUrlDetail) }, null, 2) }
      } catch {
        return item
      }
    })
  }
}

export function withPostWriteVerification(result: CallToolResult, verification: { status: string; reason: string; attempt: number }): CallToolResult {
  return {
    ...result,
    content: result.content.map(item => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return item
        return { ...item, text: JSON.stringify({ ...value, postWriteVerification: verification }, null, 2) }
      } catch { return item }
    })
  }
}

export function withPreWriteReconciliation(result: CallToolResult, reconciliation: PublicBrowserReconciliation): CallToolResult {
  const structured = result.structuredContent
  return {
    ...result,
    ...(structured && typeof structured === 'object' && !Array.isArray(structured)
      ? { structuredContent: { ...structured, preWriteReconciliation: reconciliation } } : {}),
    content: result.content.map(item => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return item
        return { ...item, text: JSON.stringify({ ...value, preWriteReconciliation: reconciliation }, null, 2) }
      } catch { return item }
    })
  }
}

export function withReconciliationOutcome(result: CallToolResult, outcome: {
  status: 'verified' | 'blocked' | 'reconciliation_required'
  authoritativeReadback: 'verified' | 'not-verified'
  dispatch: 'not-dispatched' | 'dispatched-once'
}): CallToolResult {
  const structured = result.structuredContent
  return {
    ...result,
    ...(structured && typeof structured === 'object' && !Array.isArray(structured)
      ? { structuredContent: { ...structured, reconciliationOutcome: outcome } } : {}),
    content: result.content.map(item => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return item
        return { ...item, text: JSON.stringify({ ...value, reconciliationOutcome: outcome }, null, 2) }
      } catch { return item }
    })
  }
}

export function withReviewContinuation(result: CallToolResult, continuation: {
  id: string
  revision: string
  nextStep: number
  totalSteps: number
}): CallToolResult {
  const structured = result.structuredContent
  return {
    ...result,
    ...(structured && typeof structured === 'object' && !Array.isArray(structured)
      ? { structuredContent: { ...structured, reviewContinuation: continuation } } : {}),
    content: result.content.map(item => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return item
        return { ...item, text: JSON.stringify({ ...value, reviewContinuation: continuation }, null, 2) }
      } catch { return item }
    })
  }
}
