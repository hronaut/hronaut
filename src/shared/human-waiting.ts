export type HumanWaitingDecision = 'review-page' | 'approve-action' | 'provide-input' | 'resolve-unknown'
export type HumanWaitingState = 'WAITING_FOR_HUMAN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'REJECTED'
  | 'EXPIRED' | 'CANCELLED' | 'ATTEMPTED' | 'VERIFIED' | 'UNKNOWN'
export type HumanWaitingReviewStatus = 'PROPOSED' | 'REVIEWED' | 'APPROVED' | 'REJECTED'
  | 'CANCELLED' | 'EXPIRED' | 'ATTEMPTED' | 'VERIFIED' | 'UNKNOWN'

export interface HumanWaitingReviewInput {
  toolName: string
  actionClass: 'read' | 'navigate' | 'interact' | 'browser-state' | 'site-data' | 'network' | 'external-request' | 'wallet'
  reversibility: 'reversible' | 'conditionally-reversible' | 'irreversible' | 'unknown'
  representation: 'bounded-description' | 'visible-browser-only'
  description?: string
  expectedPostcondition?: string
  artifactHash: string
  sessionBinding: string
  workspaceName: string
  profileName: string
  origin?: string
  tabId?: string
  navigationGeneration?: number
  humanInputGeneration?: number
}

export interface HumanWaitingReviewArtifact extends HumanWaitingReviewInput {
  status: HumanWaitingReviewStatus
  receipts: Array<{ status: HumanWaitingReviewStatus; at: number }>
}

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
  review?: HumanWaitingReviewInput
}

export interface HumanWaitingRecord extends Omit<HumanWaitingInput, 'timeoutMs' | 'review'> {
  id: string
  revision: string
  state: HumanWaitingState
  createdAt: number
  deadlineAt: number
  notificationAttempts: number
  notificationStatus: 'not-attempted' | 'pending' | 'delivered' | 'failed'
  nextAction: 'REVIEW_CURRENT_STATE' | 'MAKE_FRESH_DECISION'
  review?: HumanWaitingReviewArtifact
}
