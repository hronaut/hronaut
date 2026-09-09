/** Internal evidence only. Digests must be keyed by the owning process; this
 * record and its opaque IDs never grant workspace access or approve a write. */
export interface WorkspaceContinuityEvidence {
  epoch: string
  workspaceId: string
  tabId: string
  originDigest: string
  policyDigest: string
  navigationGeneration: number
  humanInteractionGeneration: number
  markerDigest?: string
}

export type { WorkspaceContinuityReason, WorkspaceContinuityResult } from '../../shared/workspace-continuity.js'
import type { WorkspaceContinuityReason, WorkspaceContinuityResult } from '../../shared/workspace-continuity.js'

function usable(evidence: WorkspaceContinuityEvidence): boolean {
  return [evidence.epoch, evidence.workspaceId, evidence.tabId, evidence.originDigest, evidence.policyDigest]
    .every(value => typeof value === 'string' && value.length > 0 && value.length <= 128)
    && [evidence.navigationGeneration, evidence.humanInteractionGeneration]
      .every(value => Number.isSafeInteger(value) && value >= 0)
    && (evidence.markerDigest === undefined || (typeof evidence.markerDigest === 'string' && evidence.markerDigest.length > 0 && evidence.markerDigest.length <= 128))
}

/** Pure comparison, not an authorization or dispatch gate. Never echoes evidence
 * or resolves prior side effects from matching continuity signals. */
export function compareWorkspaceContinuity(input: {
  checkpoint: WorkspaceContinuityEvidence | null
  current: WorkspaceContinuityEvidence | null
  priorOutcome: WorkspaceContinuityResult['priorOutcome']
  pageSettled: boolean
}): WorkspaceContinuityResult {
  const reasons: WorkspaceContinuityReason[] = []
  const { checkpoint, current } = input
  if (!checkpoint) reasons.push('CHECKPOINT_UNAVAILABLE')
  else if (!current || !usable(checkpoint) || !usable(current)) reasons.push('EVIDENCE_UNAVAILABLE')
  else {
    const fields = [
      ['epoch', 'RUNTIME_CHANGED'], ['workspaceId', 'WORKSPACE_CHANGED'],
      ['tabId', 'TAB_CHANGED'], ['originDigest', 'ORIGIN_CHANGED'],
      ['policyDigest', 'POLICY_CHANGED'], ['navigationGeneration', 'NAVIGATION_CHANGED'],
      ['humanInteractionGeneration', 'HUMAN_INPUT_CHANGED'], ['markerDigest', 'MARKER_CHANGED']
    ] as const
    for (const [field, reason] of fields) if (checkpoint[field] !== current[field]) reasons.push(reason)
  }
  if (input.priorOutcome === 'OUTCOME_UNKNOWN') reasons.push('PRIOR_WRITE_OUTCOME_UNKNOWN')
  const blocked = reasons.length > 0
  if (input.priorOutcome === 'STALE_OBSERVATION') reasons.push('PRIOR_OBSERVATION_STALE')
  if (!input.pageSettled) reasons.push('PAGE_NOT_SETTLED')
  return {
    status: blocked ? 'BLOCKED' : reasons.length ? 'WARN' : 'PASS',
    reasons,
    priorOutcome: input.priorOutcome,
    nextAction: blocked ? 'INSPECT_AND_RECONCILE' : reasons.length ? 'WAIT_AND_READ_FRESH_STATE' : 'RECHECK_BEFORE_DISPATCH'
  }
}
