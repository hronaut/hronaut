import { describe, expect, it } from 'vitest'
import { HumanWaitingStore, humanWaitingArtifactHash } from '../src/main/mcp/human-waiting-store.js'

const input = {
  workspaceId: '0198dc5b-4192-7000-8000-000000000001',
  runId: '0198dc5b-4192-7000-8000-000000000002',
  decision: 'review-page' as const,
  owner: 'local-operator',
  fallbackOwner: 'local-operator',
  timeoutMs: 1000,
  priorOutcome: 'OUTCOME_UNKNOWN' as const
}
const review = {
  toolName: 'browser_click', actionClass: 'interact' as const, reversibility: 'unknown' as const,
  representation: 'bounded-description' as const, description: 'Submit the visible form',
  expectedPostcondition: 'A confirmation appears', artifactHash: 'a'.repeat(64), sessionBinding: 'b'.repeat(64),
  workspaceName: 'Checkout QA', profileName: 'Restricted QA', origin: 'https://example.com',
  tabId: '0198dc5b-4192-7000-8000-000000000004', navigationGeneration: 4, humanInputGeneration: 2
}

describe('human waiting lifecycle', () => {
  it('restores an unresolved decision with a fresh revision and its remaining deadline', () => {
    const original = new HumanWaitingStore({ wallNow: () => 1000, monotonicNow: () => 0 })
    const created = original.create(input)
    original.acknowledge(created.id, created.revision)
    const snapshot = original.snapshot()
    let now = 20
    const restored = new HumanWaitingStore({ wallNow: () => 1500, monotonicNow: () => now })
    restored.restore(snapshot)
    const record = restored.list(input.workspaceId)[0]!
    expect(record).toMatchObject({ id: created.id, state: 'WAITING_FOR_HUMAN', priorOutcome: 'OUTCOME_UNKNOWN' })
    expect(record.revision).not.toBe(snapshot.records[0]!.revision)
    expect(() => restored.resolve(created.id, snapshot.records[0]!.revision)).toThrow(/stale/i)
    now = 520
    expect(restored.list(input.workspaceId)[0]?.state).toBe('EXPIRED')
  })

  it('expires restored waits on wall-clock rollback and never revives terminal decisions', () => {
    const original = new HumanWaitingStore({ wallNow: () => 1000 })
    const cancelled = original.create(input)
    original.cancel(cancelled.id, cancelled.revision)
    original.create(input)
    const restored = new HumanWaitingStore({ wallNow: () => 999 })
    restored.restore(original.snapshot())
    expect(restored.list(input.workspaceId).map(record => record.state)).toEqual(['CANCELLED', 'EXPIRED'])
  })

  it('rejects duplicate or oversized snapshots atomically', () => {
    const original = new HumanWaitingStore()
    original.create(input)
    const snapshot = original.snapshot()
    const restored = new HumanWaitingStore({ capacity: 1 })
    expect(() => restored.restore({ ...snapshot, records: [snapshot.records[0], snapshot.records[0]] })).toThrow()
    expect(restored.list(input.workspaceId)).toEqual([])
    restored.restore(snapshot)
    expect(() => restored.restore(snapshot)).toThrow()
  })

  it('keeps an acknowledged decision waiting and retains its unknown prior effect', () => {
    const store = new HumanWaitingStore()
    const created = store.create(input)
    const acknowledged = store.acknowledge(created.id, created.revision)
    expect(acknowledged).toMatchObject({ state: 'ACKNOWLEDGED', priorOutcome: 'OUTCOME_UNKNOWN', nextAction: 'REVIEW_CURRENT_STATE' })
    expect(store.list(input.workspaceId)).toHaveLength(1)
    expect(() => store.resolve(created.id, created.revision)).toThrow(/stale/i)
    expect(store.resolve(created.id, acknowledged.revision)).toMatchObject({ state: 'RESOLVED', priorOutcome: 'OUTCOME_UNKNOWN', nextAction: 'MAKE_FRESH_DECISION' })
  })

  it('expires at the deadline and rejects an old resolution without replaying anything', () => {
    let now = 0
    const store = new HumanWaitingStore({ monotonicNow: () => now })
    const record = store.create(input)
    now = 999
    expect(store.list(input.workspaceId)[0]?.state).toBe('WAITING_FOR_HUMAN')
    now = 1000
    expect(store.list(input.workspaceId)[0]).toMatchObject({ state: 'EXPIRED', nextAction: 'MAKE_FRESH_DECISION', priorOutcome: 'OUTCOME_UNKNOWN' })
    expect(() => store.resolve(record.id, record.revision)).toThrow()
  })

  it('expires conservatively when the monotonic clock moves backwards', () => {
    let now = 100
    const store = new HumanWaitingStore({ monotonicNow: () => now })
    store.create(input)
    now = 99
    expect(store.list(input.workspaceId)[0]?.state).toBe('EXPIRED')
  })

  it('never evicts an unresolved decision to admit another request', () => {
    const store = new HumanWaitingStore({ capacity: 1 })
    const record = store.create(input)
    expect(() => store.create(input)).toThrow(/capacity/i)
    store.cancel(record.id, record.revision)
    expect(store.create(input).state).toBe('WAITING_FOR_HUMAN')
  })

  it('does not extend waiting when the clock rolls back after an intermediate read', () => {
    let now = 100
    const store = new HumanWaitingStore({ monotonicNow: () => now })
    store.create(input)
    now = 900
    expect(store.list(input.workspaceId)[0]?.state).toBe('WAITING_FOR_HUMAN')
    now = 500
    expect(store.list(input.workspaceId)[0]?.state).toBe('EXPIRED')
  })

  it('preserves retained history when a new request has no usable wall clock', () => {
    let wall = 1000
    const store = new HumanWaitingStore({ capacity: 1, wallNow: () => wall })
    const record = store.create(input)
    store.cancel(record.id, record.revision)
    wall = NaN
    expect(() => store.create(input)).toThrow(/clock/i)
    expect(store.list(input.workspaceId)[0]?.id).toBe(record.id)
  })

  it('does not expose another workspace through filtered discovery or mutable return values', () => {
    const store = new HumanWaitingStore()
    const record = store.create(input)
    record.owner = 'changed'
    expect(store.list('0198dc5b-4192-7000-8000-000000000003')).toEqual([])
    expect(store.list(input.workspaceId)[0]?.owner).toBe(input.owner)
  })

  it('keeps notification delivery separate from acknowledgment and bounds repeated alerts', () => {
    const store = new HumanWaitingStore()
    const record = store.create(input)
    expect(store.recordNotification(record.id, 'delivered').state).toBe('WAITING_FOR_HUMAN')
    store.recordNotification(record.id, 'failed')
    store.recordNotification(record.id, 'delivered')
    expect(() => store.recordNotification(record.id, 'delivered')).toThrow(/notification/i)
    expect(store.list(input.workspaceId)[0]?.notificationAttempts).toBe(3)
  })

  it('rejects malformed identifiers, decision kinds, and unbounded deadlines', () => {
    const store = new HumanWaitingStore()
    expect(() => store.create({ ...input, workspaceId: '../private' })).toThrow()
    expect(() => store.create({ ...input, timeoutMs: Infinity })).toThrow()
    expect(() => store.create({ ...input, timeoutMs: 0 })).toThrow()
    expect(() => store.create({ ...input, owner: 'x'.repeat(129) })).toThrow()
  })

  it('hashes normalized JSON canonically without retaining proposed secrets', () => {
    const first = humanWaitingArtifactHash('browser_click', { workspaceId: input.workspaceId, value: 'private-secret', nested: { b: 2, a: 1 } })
    const second = humanWaitingArtifactHash('browser_click', { nested: { a: 1, b: 2 }, value: 'private-secret', workspaceId: input.workspaceId })
    expect(first).toBe(second)
    const store = new HumanWaitingStore()
    store.create({ ...input, decision: 'approve-action', review: { ...review, artifactHash: first } })
    expect(JSON.stringify(store.snapshot())).not.toContain('private-secret')
  })

  it('records approval, attempted dispatch, and verified outcome as a single-use timeline', () => {
    const store = new HumanWaitingStore({ wallNow: () => 1000 })
    const proposed = store.create({ ...input, decision: 'approve-action', review })
    const reviewed = store.acknowledge(proposed.id, proposed.revision)
    const approved = store.resolve(reviewed.id, reviewed.revision)
    const attempt = store.beginReviewAttempt(approved.id, approved.revision, review)
    expect(attempt).toMatchObject({ accepted: true, record: { state: 'ATTEMPTED', review: { status: 'ATTEMPTED' } } })
    const verified = store.finishReviewAttempt(attempt.record.id, attempt.record.revision, 'verified')
    expect(verified.review?.receipts.map(receipt => receipt.status)).toEqual(['PROPOSED', 'REVIEWED', 'APPROVED', 'ATTEMPTED', 'VERIFIED'])
    expect(() => store.beginReviewAttempt(approved.id, approved.revision, review)).toThrow(/stale/i)
  })

  it('expires an approval on exact mismatch and preserves an ambiguous attempted outcome across restart', () => {
    const original = new HumanWaitingStore({ wallNow: () => 1000, monotonicNow: () => 0 })
    const proposed = original.create({ ...input, decision: 'approve-action', review })
    const approved = original.resolve(proposed.id, proposed.revision)
    expect(original.beginReviewAttempt(approved.id, approved.revision, { ...review, artifactHash: 'c'.repeat(64) })).toMatchObject({ accepted: false, record: { state: 'EXPIRED' } })

    const second = new HumanWaitingStore({ wallNow: () => 1000, monotonicNow: () => 0 })
    const next = second.create({ ...input, decision: 'approve-action', review })
    const nextApproved = second.resolve(next.id, next.revision)
    second.beginReviewAttempt(nextApproved.id, nextApproved.revision, review)
    const restored = new HumanWaitingStore({ wallNow: () => 1001, monotonicNow: () => 0 })
    restored.restore(second.snapshot())
    expect(restored.list(input.workspaceId)[0]).toMatchObject({ state: 'UNKNOWN', review: { status: 'UNKNOWN' } })
  })

  it('supports cheap rejection and cancellation and expires approved artifacts at the deadline', () => {
    let now = 0
    const store = new HumanWaitingStore({ monotonicNow: () => now })
    const rejected = store.create({ ...input, decision: 'approve-action', review })
    expect(store.reject(rejected.id, rejected.revision)).toMatchObject({ state: 'REJECTED', review: { status: 'REJECTED' } })
    const cancelled = store.create({ ...input, decision: 'approve-action', review })
    expect(store.cancel(cancelled.id, cancelled.revision)).toMatchObject({ state: 'CANCELLED', review: { status: 'CANCELLED' } })
    const expiring = store.create({ ...input, decision: 'approve-action', review })
    const approved = store.resolve(expiring.id, expiring.revision)
    now = 1000
    expect(store.list(input.workspaceId).find(record => record.id === approved.id)).toMatchObject({ state: 'EXPIRED', review: { status: 'EXPIRED' } })
  })
})
