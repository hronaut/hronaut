import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserTabsManager } from '../../browser/tabs-manager.js'
import { McpCapabilityAuthorizationError } from '../capability-profile-store.js'
import { textResult } from '../tool-results.js'
import { WorkspaceWriteLeaseError } from '../workspace-write-leases.js'
import type { WorkspaceToolCall } from './tool-context.js'

function pageObservationPublicationFailure(error: unknown): CallToolResult {
  const outcome = {
    status: 'OUTCOME_UNKNOWN',
    reason: error instanceof WorkspaceWriteLeaseError ? error.code : 'OBSERVATION_NOT_PUBLISHED',
    dispatch: 'dispatched', effects: 'possible', retrySafe: false,
    observation: 'discarded', postcondition: 'unknown', reconciliationRequired: true,
    ...(error instanceof McpCapabilityAuthorizationError ? { permission: 'denied', policyDecision: error.decision } : {}),
    nextAction: 'The observation completed but publication authority changed. Its content was discarded. Capturing may have woken, selected or scrolled the page; those effects are not rolled back. Inspect current state and authorization before continuing; do not automatically replay the request.'
  }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

/**
 * How a whole-page snapshot or screenshot settles a call. The capture is published only if the call still holds
 * its target and workspace observation access when it settles; otherwise its content is discarded and the call
 * reports that the capture may have changed the page.
 */
export function pageObservationSettlement(manager: BrowserTabsManager) {
  let publication: (() => void) | undefined
  return {
    authorizesResolvedTab: true,
    prepare: (call: WorkspaceToolCall<unknown>): void => {
      const requireObservationWorkspace = manager.captureWorkspaceObservationGuard(call.workspaceId)
      publication = () => {
        if (call.signal?.aborted) throw new Error('Page observation cancelled')
        call.requireCurrentTarget()
        requireObservationWorkspace()
      }
    },
    publicationRevoked: (error: unknown, result: CallToolResult): CallToolResult | undefined =>
      result.isError ? undefined : pageObservationPublicationFailure(error),
    publish: (result: CallToolResult): CallToolResult | undefined => {
      if (result.isError) return undefined
      try {
        if (!publication) throw new Error('Page observation publication guard is unavailable')
        publication()
      } catch (error) {
        return pageObservationPublicationFailure(error)
      }
      return undefined // Published as is by the shared settlement, with no await after this check.
    }
  }
}

export type PageObservationSettlement = ReturnType<typeof pageObservationSettlement>
