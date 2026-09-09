export type HumanWaitingDecision = 'review-page' | 'approve-action' | 'provide-input' | 'resolve-unknown'
export type HumanWaitingState = 'WAITING_FOR_HUMAN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'EXPIRED' | 'CANCELLED'

/** Bounded local routing labels and decision kinds, not arbitrary page content.
 * Correlation identifiers never authorize access or replay a browser operation.
 */
export interface HumanWaitingInput {
  workspaceId: string
  runId: string
  decision: HumanWaitingDecision
  owner: string
  fallbackOwner: string
  timeoutMs: number
  priorOutcome: 'NONE' | 'STALE_OBSERVATION' | 'OUTCOME_UNKNOWN'
}

export interface HumanWaitingRecord extends Omit<HumanWaitingInput, 'timeoutMs'> {
  id: string
  revision: string
  state: HumanWaitingState
  createdAt: number
  deadlineAt: number
  notificationAttempts: number
  notificationStatus: 'not-attempted' | 'pending' | 'delivered' | 'failed'
  nextAction: 'REVIEW_CURRENT_STATE' | 'MAKE_FRESH_DECISION'
}
