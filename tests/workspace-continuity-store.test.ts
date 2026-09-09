import { describe, expect, it } from 'vitest'
import { WorkspaceContinuityStore } from '../src/main/mcp/workspace-continuity-store.js'
import type { WorkspaceContinuityEvidence } from '../src/main/mcp/workspace-continuity.js'

const evidence: WorkspaceContinuityEvidence = { epoch: 'epoch', workspaceId: 'workspace', tabId: 'tab', originDigest: 'origin', policyDigest: 'policy', navigationGeneration: 0, humanInteractionGeneration: 0 }

describe('workspace continuity lifecycle', () => {
  it('restores guarded identities without treating missing runtime evidence as safe', () => {
    const original = new WorkspaceContinuityStore(); original.arm(evidence)
    const restarted = new WorkspaceContinuityStore()
    original.guardedWorkspaceIds().forEach(id => restarted.restoreStale(id))
    expect(() => restarted.requireDispatch('workspace')).toThrow()
    const review = restarted.inspect('workspace', evidence, true)
    expect(review).toMatchObject({ status: 'BLOCKED', priorOutcome: 'OUTCOME_UNKNOWN', reasons: ['CHECKPOINT_UNAVAILABLE', 'PRIOR_WRITE_OUTCOME_UNKNOWN'] })
    expect(() => restarted.arm(evidence)).toThrow('Reconcile')
    expect(() => restarted.reconcile('workspace', review.reviewId!, evidence, true, false)).toThrow('acknowledge')
    restarted.reconcile('workspace', review.reviewId!, evidence, true, true)
    expect(() => restarted.requireDispatch('workspace')).not.toThrow()
  })

  it('retains a suspended guard across repeated reconnects and rejects replacement', () => {
    const store = new WorkspaceContinuityStore()
    store.arm(evidence); store.suspend('workspace', 'NONE'); store.suspend('workspace', 'NONE')
    expect(() => store.requireDispatch('workspace')).toThrow('fresh review')
    expect(() => store.arm(evidence)).toThrow('Reconcile')
  })
  it('binds reconciliation to the reviewed browser state', () => {
    const store = new WorkspaceContinuityStore()
    store.arm(evidence); store.suspend('workspace', 'NONE')
    const changed = { ...evidence, navigationGeneration: 1 }
    const review = store.inspect('workspace', changed, true)
    expect(review.status).toBe('BLOCKED')
    expect(() => store.reconcile('workspace', review.reviewId!, { ...changed, humanInteractionGeneration: 1 }, true, false)).toThrow('changed')
    expect(() => store.requireDispatch('workspace')).toThrow()
    const fresh = store.inspect('workspace', changed, true)
    store.reconcile('workspace', fresh.reviewId!, changed, true, false)
    expect(() => store.requireDispatch('workspace')).not.toThrow()
    expect(() => store.reconcile('workspace', fresh.reviewId!, changed, true, false)).toThrow('stale')
  })
  it('preserves unknown writes through subsequent reads and requires explicit acknowledgement', () => {
    const store = new WorkspaceContinuityStore()
    store.arm(evidence); store.suspend('workspace', 'OUTCOME_UNKNOWN'); store.suspend('workspace', 'STALE_OBSERVATION')
    const review = store.inspect('workspace', evidence, true)
    expect(review.priorOutcome).toBe('OUTCOME_UNKNOWN')
    expect(() => store.reconcile('workspace', review.reviewId!, evidence, true, false)).toThrow('acknowledge')
    store.reconcile('workspace', review.reviewId!, evidence, true, true)
    expect(store.inspect('workspace', evidence, true).priorOutcome).toBe('OUTCOME_UNKNOWN')
  })
  it('distinguishes an acknowledged unknown outcome from a pending review without claiming success', () => {
    const store = new WorkspaceContinuityStore()
    store.arm(evidence); store.suspend('workspace', 'OUTCOME_UNKNOWN')
    const review = store.inspect('workspace', evidence, true)
    expect(review).toMatchObject({ status: 'BLOCKED', priorOutcomeAcknowledged: false })
    store.reconcile('workspace', review.reviewId!, evidence, true, true)
    expect(store.inspect('workspace', evidence, true)).toMatchObject({
      status: 'WARN', suspended: false, priorOutcome: 'OUTCOME_UNKNOWN',
      priorOutcomeAcknowledged: true, reasons: ['PRIOR_WRITE_OUTCOME_UNKNOWN'], nextAction: 'RECHECK_BEFORE_DISPATCH'
    })
    expect(store.inspect('workspace', { ...evidence, navigationGeneration: 1 }, true)).toMatchObject({
      status: 'BLOCKED', priorOutcomeAcknowledged: true, nextAction: 'INSPECT_AND_RECONCILE'
    })
    store.suspend('workspace', 'NONE')
    const nextReview = store.inspect('workspace', evidence, true)
    expect(nextReview).toMatchObject({ status: 'BLOCKED', priorOutcomeAcknowledged: false })
    expect(() => store.reconcile('workspace', nextReview.reviewId!, evidence, true, false)).toThrow('acknowledge')
  })
  it('does not issue review handles for unavailable or cross-workspace evidence', () => {
    const store = new WorkspaceContinuityStore(); store.arm(evidence)
    for (const current of [null, { ...evidence, workspaceId: 'other' }, { ...evidence, originDigest: '' }]) {
      expect(store.inspect('workspace', current, true).reviewId).toBeNull()
    }
    expect(store.inspect('workspace', evidence, false).reviewId).toBeNull()
  })
  it('does not evict a pending guard at capacity', () => {
    const store = new WorkspaceContinuityStore(1)
    store.arm(evidence); store.suspend('workspace', 'NONE')
    expect(() => store.arm({ ...evidence, workspaceId: 'other' })).toThrow('capacity')
    expect(() => store.requireDispatch('workspace')).toThrow()
    store.retire('workspace')
    expect(() => store.arm({ ...evidence, workspaceId: 'other' })).not.toThrow()
  })
  it('does not allow caller mutation or an old review to change a checkpoint', () => {
    const store = new WorkspaceContinuityStore()
    const supplied = { ...evidence }; store.arm(supplied); supplied.tabId = 'changed'
    store.suspend('workspace', 'NONE')
    const first = store.inspect('workspace', evidence, true)
    expect(first.status).toBe('PASS')
    store.inspect('workspace', evidence, true)
    expect(() => store.reconcile('workspace', first.reviewId!, evidence, true, false)).toThrow('stale')
  })
})
