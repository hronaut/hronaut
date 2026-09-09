export type WorkspaceContinuityReason =
  | 'CHECKPOINT_UNAVAILABLE' | 'EVIDENCE_UNAVAILABLE' | 'RUNTIME_CHANGED'
  | 'WORKSPACE_CHANGED' | 'TAB_CHANGED' | 'ORIGIN_CHANGED' | 'POLICY_CHANGED'
  | 'NAVIGATION_CHANGED' | 'HUMAN_INPUT_CHANGED' | 'MARKER_CHANGED'
  | 'PRIOR_WRITE_OUTCOME_UNKNOWN' | 'PRIOR_OBSERVATION_STALE' | 'PAGE_NOT_SETTLED'

export interface WorkspaceContinuityResult {
  status: 'PASS' | 'WARN' | 'BLOCKED'
  reasons: WorkspaceContinuityReason[]
  priorOutcome: 'NONE' | 'STALE_OBSERVATION' | 'OUTCOME_UNKNOWN'
  nextAction: 'RECHECK_BEFORE_DISPATCH' | 'WAIT_AND_READ_FRESH_STATE' | 'INSPECT_AND_RECONCILE'
}


export interface WorkspaceContinuityReport extends WorkspaceContinuityResult {
  checkpointId: string | null
  reviewId: string | null
  suspended: boolean
  priorOutcomeAcknowledged: boolean
}
