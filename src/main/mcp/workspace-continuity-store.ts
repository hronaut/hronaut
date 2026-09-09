import { randomUUID } from 'node:crypto'
import { compareWorkspaceContinuity, type WorkspaceContinuityEvidence, type WorkspaceContinuityResult } from './workspace-continuity.js'

type PriorOutcome = WorkspaceContinuityResult['priorOutcome']
interface Review {
  id: string
  evidence: WorkspaceContinuityEvidence
  priorOutcome: PriorOutcome
}
interface Checkpoint {
  id: string
  evidence: WorkspaceContinuityEvidence | null
  suspended: boolean
  priorOutcome: PriorOutcome
  priorOutcomeAcknowledged?: boolean
  review?: Review
}

/** Owned by the browser manager, not an MCP connection. Callers must separately
 * authorize every operation. Handles are correlation IDs, never capabilities. */
export class WorkspaceContinuityStore {
  private readonly records = new Map<string, Checkpoint>()

  constructor(private readonly capacity = 100) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new TypeError('Invalid continuity capacity')
  }

  guardedWorkspaceIds(): string[] {
    return [...this.records.keys()]
  }

  restoreStale(workspaceId: string): void {
    if (this.records.has(workspaceId)) throw new Error('Continuity checkpoint already exists')
    if (this.records.size >= this.capacity) throw new Error('Continuity checkpoint capacity reached')
    this.records.set(workspaceId, { id: randomUUID(), evidence: null, suspended: true, priorOutcome: 'OUTCOME_UNKNOWN' })
  }

  arm(evidence: WorkspaceContinuityEvidence): string {
    if (compareWorkspaceContinuity({ checkpoint: evidence, current: evidence, priorOutcome: 'NONE', pageSettled: true }).status !== 'PASS') {
      throw new Error('Continuity evidence is unavailable')
    }
    const prior = this.records.get(evidence.workspaceId)
    if (prior?.suspended) throw new Error('Reconcile the suspended checkpoint before replacing it')
    // Never evict another workspace's guard when this bounded store fills up.
    if (!prior && this.records.size >= this.capacity) throw new Error('Continuity checkpoint capacity reached')
    const id = randomUUID()
    this.records.set(evidence.workspaceId, { id, evidence: structuredClone(evidence), suspended: false, priorOutcome: 'NONE' })
    return id
  }

  suspend(workspaceId: string, outcome: PriorOutcome): void {
    const record = this.records.get(workspaceId)
    if (!record) return
    record.suspended = true
    record.priorOutcomeAcknowledged = false
    // Unknown write effects survive later reads, repeated pauses, and reconnects.
    if (outcome === 'OUTCOME_UNKNOWN' || record.priorOutcome === 'OUTCOME_UNKNOWN') record.priorOutcome = 'OUTCOME_UNKNOWN'
    else if (outcome === 'STALE_OBSERVATION' || record.priorOutcome === 'STALE_OBSERVATION') record.priorOutcome = 'STALE_OBSERVATION'
    record.review = undefined
  }

  inspect(workspaceId: string, current: WorkspaceContinuityEvidence | null, pageSettled: boolean): WorkspaceContinuityResult & { checkpointId: string | null; reviewId: string | null; suspended: boolean; priorOutcomeAcknowledged: boolean } {
    const record = this.records.get(workspaceId)
    const priorOutcome = record?.priorOutcome ?? 'NONE'
    const priorOutcomeAcknowledged = record?.priorOutcomeAcknowledged === true
    const result = compareWorkspaceContinuity({ checkpoint: record?.evidence ?? null, current, pageSettled, priorOutcome: priorOutcomeAcknowledged ? 'NONE' : priorOutcome })
    if (priorOutcomeAcknowledged && priorOutcome === 'OUTCOME_UNKNOWN') {
      // An explicit fresh decision does not establish whether the earlier write
      // succeeded. Keep that warning without asking for the same review again.
      result.reasons.push('PRIOR_WRITE_OUTCOME_UNKNOWN')
      if (result.status === 'PASS') result.status = 'WARN'
    }
    if (record) {
      record.review = undefined
      // A review may reconcile drift, but cannot acknowledge a missing, malformed,
      // cross-workspace or still-loading observation as a fresh baseline.
      if (current?.workspaceId === workspaceId && pageSettled && compareWorkspaceContinuity({ checkpoint: current, current, pageSettled, priorOutcome: 'NONE' }).status === 'PASS') {
        record.review = { id: randomUUID(), evidence: structuredClone(current), priorOutcome: record.priorOutcome }
      }
    }
    // Matching evidence is a comparison result, not permission to skip the
    // explicit review required by a suspended run.
    if (record?.suspended && record.review) result.nextAction = 'INSPECT_AND_RECONCILE'
    return { ...result, priorOutcome, priorOutcomeAcknowledged, checkpointId: record?.id ?? null, reviewId: record?.review?.id ?? null, suspended: record?.suspended ?? true }
  }

  reconcile(workspaceId: string, reviewId: string, current: WorkspaceContinuityEvidence | null, pageSettled: boolean, acknowledgeUnknownOutcome: boolean): void {
    const record = this.records.get(workspaceId)
    const review = record?.review
    if (!record || !review || review.id !== reviewId || current?.workspaceId !== workspaceId) throw new Error('Continuity review is unavailable or stale')
    if (compareWorkspaceContinuity({ checkpoint: review.evidence, current, pageSettled, priorOutcome: 'NONE' }).status !== 'PASS') {
      record.review = undefined
      throw new Error('Browser state changed after continuity review')
    }
    if (review.priorOutcome === 'OUTCOME_UNKNOWN' && !acknowledgeUnknownOutcome) throw new Error('Explicitly acknowledge the unresolved prior outcome')
    record.evidence = structuredClone(current)
    // A fresh reviewed observation replaces a stale read. Unknown write effects
    // cannot be resolved by observing the current page and remain recorded.
    if (record.priorOutcome === 'STALE_OBSERVATION') record.priorOutcome = 'NONE'
    record.suspended = false
    record.priorOutcomeAcknowledged = record.priorOutcome === 'OUTCOME_UNKNOWN' && acknowledgeUnknownOutcome
    record.review = undefined
    // Reconciliation permits a fresh decision, never claims the old write succeeded.
    // Keep the unknown outcome visible until an explicit new checkpoint is armed.
  }

  requireDispatch(workspaceId: string): void {
    if (this.records.get(workspaceId)?.suspended) throw new Error('Workspace continuity requires fresh review before dispatch')
  }

  /** Only permanent workspace deletion should retire its pending guard. */
  retire(workspaceId: string): void {
    this.records.delete(workspaceId)
  }
}
