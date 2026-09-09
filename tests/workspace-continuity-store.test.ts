import { describe, expect, it } from 'vitest'
import { WorkspaceContinuityStore } from '../src/main/mcp/workspace-continuity-store.js'
import type { WorkspaceContinuityEvidence } from '../src/main/mcp/workspace-continuity.js'

const evidence: WorkspaceContinuityEvidence = { epoch: 'epoch', workspaceId: 'workspace', tabId: 'tab', originDigest: 'origin', policyDigest: 'policy', navigationGeneration: 0, humanInteractionGeneration: 0 }

describe('workspace continuity lifecycle', () => {
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
