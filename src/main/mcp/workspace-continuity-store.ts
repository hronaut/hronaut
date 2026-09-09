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
  evidence: WorkspaceContinuityEvidence
  suspended: boolean
  priorOutcome: PriorOutcome
  review?: Review
}

/** Owned by the browser manager, not an MCP connection. Callers must separately
 * authorize every operation. Handles are correlation IDs, never capabilities. */
export class WorkspaceContinuityStore {
  private readonly records = new Map<string, Checkpoint>()

  constructor(private readonly capacity = 100) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new TypeError('Invalid continuity capacity')
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
    // Unknown write effects survive later reads, repeated pauses, and reconnects.
    if (outcome === 'OUTCOME_UNKNOWN' || record.priorOutcome === 'OUTCOME_UNKNOWN') record.priorOutcome = 'OUTCOME_UNKNOWN'
    else if (outcome === 'STALE_OBSERVATION' || record.priorOutcome === 'STALE_OBSERVATION') record.priorOutcome = 'STALE_OBSERVATION'
    record.review = undefined
  }

  inspect(workspaceId: string, current: WorkspaceContinuityEvidence | null, pageSettled: boolean): WorkspaceContinuityResult & { checkpointId: string | null; reviewId: string | null; suspended: boolean } {
    const record = this.records.get(workspaceId)
    const result = compareWorkspaceContinuity({ checkpoint: record?.evidence ?? null, current, pageSettled, priorOutcome: record?.priorOutcome ?? 'NONE' })
    if (record) {
      record.review = undefined
      // A review may reconcile drift, but cannot acknowledge a missing, malformed,
      // cross-workspace or still-loading observation as a fresh baseline.
      if (current?.workspaceId === workspaceId && pageSettled && compareWorkspaceContinuity({ checkpoint: current, current, pageSettled, priorOutcome: 'NONE' }).status === 'PASS') {
        record.review = { id: randomUUID(), evidence: structuredClone(current), priorOutcome: record.priorOutcome }
      }
    }
    return { ...result, checkpointId: record?.id ?? null, reviewId: record?.review?.id ?? null, suspended: record?.suspended ?? true }
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
    record.suspended = false
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
