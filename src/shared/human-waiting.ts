export type HumanWaitingDecision = 'review-page' | 'approve-action' | 'provide-input' | 'resolve-unknown'
/** The English line a decision's attention request carries. MCP results and the tray keep it; the renderer names the decision instead. */
export function humanDecisionAttentionReason(decision: HumanWaitingDecision): string {
  return `Human decision required: ${decision}`
}
export type HumanWaitingState = 'WAITING_FOR_HUMAN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'REJECTED'
  | 'EXPIRED' | 'CANCELLED' | 'ATTEMPTED' | 'VERIFIED' | 'UNKNOWN'
/** Still waiting for the person: not yet answered, cancelled or expired. */
export function humanWaitingDecisionOpen(state: HumanWaitingState): boolean {
  return state === 'WAITING_FOR_HUMAN' || state === 'ACKNOWLEDGED'
}
export type HumanWaitingReviewStatus = 'PROPOSED' | 'REVIEWED' | 'APPROVED' | 'REJECTED'
  | 'CANCELLED' | 'EXPIRED' | 'ATTEMPTED' | 'VERIFIED' | 'UNKNOWN'

/** A transient assertion from the trusted local review UI. It deliberately
 * carries no account identifier, page text, or reusable authority. */
export interface HumanWaitingTrustedConfirmation {
  accountAndTargetVerified: true
}

export interface HumanWaitingReviewStep {
  toolName: string
  actionClass: 'read' | 'navigate' | 'interact' | 'browser-state' | 'site-data' | 'network' | 'external-request' | 'wallet'
  reversibility: 'reversible' | 'conditionally-reversible' | 'irreversible' | 'unknown'
  representation: 'bounded-description' | 'visible-browser-only'
  description?: string
  expectedPostcondition?: string
  artifactHash: string
  origin?: string
  tabId?: string
  navigationGeneration?: number
  humanInputGeneration?: number
  browserSessionGeneration?: number
}

export interface HumanWaitingReviewInput extends HumanWaitingReviewStep {
  sessionBinding: string
  workspaceName: string
  profileName: string
  /** Present only for a bounded ordered group. The top-level fields mirror the
   * currently authorized step so older clients remain fail-closed. */
  steps?: HumanWaitingReviewStep[]
  currentStep?: number
}

export interface HumanWaitingReviewArtifact extends HumanWaitingReviewInput {
  status: HumanWaitingReviewStatus
  receipts: Array<{ status: HumanWaitingReviewStatus; at: number }>
}

export function requiresHumanWaitingAccountAndTargetConfirmation(input: {
  decision: HumanWaitingDecision
  review?: HumanWaitingReviewInput
}): boolean {
  if (input.decision !== 'approve-action' || !input.review) return false
  return (input.review.steps ?? [input.review])
    .some(step => step.toolName.startsWith('browser_') && step.tabId !== undefined)
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
  /** When the person answered it in Hronaut: resolved, rejected or cancelled it. Kept in memory only. */
  answeredAt?: number
  /** What the person wrote to the agent with a resolution or rejection. Kept in memory only, never saved. */
  note?: string
}

/** The longest note a person can send an agent with an answer, in UTF-16 code units. */
export const HUMAN_WAITING_NOTE_LIMIT = 1_000

/**
 * A person's note for the agent, as they see it: line breaks become LF and tabs spaces; other control
 * characters and invisible format characters (bidi controls, zero-width and tag characters, but not the
 * joiners emoji and some scripts need) are dropped, as is surrounding space. Undefined when nothing is left,
 * or null when it is not text or is longer than the limit.
 */
export function normalizeHumanWaitingNote(value: unknown): string | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  const note = value
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]|(?![\u200C\u200D])\p{Cf}/gu, '')
    .trim()
  if (note.length > HUMAN_WAITING_NOTE_LIMIT) return null
  return note || undefined
}
