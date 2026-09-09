import { describe, expect, it } from 'vitest'
import { HumanWaitingStore } from '../src/main/mcp/human-waiting-store.js'

const input = {
  workspaceId: '0198dc5b-4192-7000-8000-000000000001',
  runId: '0198dc5b-4192-7000-8000-000000000002',
  decision: 'review-page' as const,
  owner: 'local-operator',
  fallbackOwner: 'local-operator',
  timeoutMs: 1000,
  priorOutcome: 'OUTCOME_UNKNOWN' as const
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
})
