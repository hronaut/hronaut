import { describe, expect, it } from 'vitest'
import { TaskRunStore } from '../src/main/mcp/task-run-store.js'

const WORKSPACE_ID = '018f4d10-7b4a-7000-8000-000000000001'
const TAB_ID = '018f4d10-7b4a-7000-8000-000000000002'

function clock() {
  let monotonic = 1_000
  let wall = 1_800_000_000_000
  return {
    monotonicNow: () => monotonic,
    wallNow: () => wall,
    advance(milliseconds: number) { monotonic += milliseconds; wall += milliseconds },
    rollback() { monotonic -= 1; wall -= 1 }
  }
}

describe('bounded browser task-run contracts', () => {
  it('registers a privacy-safe run and requires machine-checked evidence before success', () => {
    const time = clock()
    const store = new TaskRunStore({ monotonicNow: time.monotonicNow, wallNow: time.wallNow })
    const created = store.create({
      workspaceId: WORKSPACE_ID,
      deadlineMs: 60_000,
      heartbeatTimeoutMs: 10_000,
      checks: [
        { id: 'page', type: 'page-settled', tabId: TAB_ID },
        { id: 'origin', type: 'expected-origin', tabId: TAB_ID, fingerprint: 'a'.repeat(64) }
      ]
    })

    expect(created).toMatchObject({
      workspaceId: WORKSPACE_ID,
      state: 'RUNNING',
      terminalReason: null,
      checks: [
        { id: 'page', type: 'page-settled', tabId: TAB_ID, status: 'PENDING' },
        { id: 'origin', type: 'expected-origin', tabId: TAB_ID, status: 'PENDING' }
      ]
    })
    expect(JSON.stringify(created)).not.toContain('a'.repeat(64))

    const blocked = store.complete(created.id, created.revision, 'SUCCEEDED', [
      { id: 'page', status: 'PASS' },
      { id: 'origin', status: 'FAIL' }
    ])
    expect(blocked).toMatchObject({ state: 'BLOCKED', terminalReason: 'COMPLETION_CHECK_FAILED' })
    expect(blocked.checks).toEqual([
      { id: 'page', type: 'page-settled', tabId: TAB_ID, status: 'PASS' },
      { id: 'origin', type: 'expected-origin', tabId: TAB_ID, status: 'FAIL' }
    ])
  })

  it('records unavailable completion evidence as an unknown outcome', () => {
    const time = clock()
    const store = new TaskRunStore({ monotonicNow: time.monotonicNow, wallNow: time.wallNow })
    const run = store.create({
      workspaceId: WORKSPACE_ID,
      deadlineMs: 60_000,
      heartbeatTimeoutMs: 10_000,
      checks: [{ id: 'audit', type: 'audit-run', artifactId: '018f4d10-7b4a-7000-8000-000000000099' }]
    })

    const result = store.complete(run.id, run.revision, 'SUCCEEDED', [{ id: 'audit', status: 'UNAVAILABLE' }])
    expect(result).toMatchObject({ state: 'OUTCOME_UNKNOWN', terminalReason: 'COMPLETION_EVIDENCE_UNAVAILABLE' })
    expect(result.checks).toEqual([{ id: 'audit', type: 'audit-run', status: 'UNAVAILABLE', artifactId: '018f4d10-7b4a-7000-8000-000000000099' }])
  })

  it('publishes success only after a durable verification admission is confirmed', () => {
    const store = new TaskRunStore()
    const run = store.create({
      workspaceId: WORKSPACE_ID,
      deadlineMs: 60_000,
      heartbeatTimeoutMs: 10_000,
      checks: [{ id: 'page', type: 'page-settled', tabId: TAB_ID }]
    })
    const verifying = store.complete(run.id, run.revision, 'SUCCEEDED', [{ id: 'page', status: 'PASS' }])
    expect(verifying.state).toBe('VERIFYING')
    expect(store.confirmSuccess(verifying.id, verifying.revision)).toMatchObject({ state: 'SUCCEEDED', terminalReason: null })
  })

  it('times out a run when its heartbeat expires without extending the overall deadline', () => {
    const time = clock()
    const store = new TaskRunStore({ monotonicNow: time.monotonicNow, wallNow: time.wallNow })
    const run = store.create({ workspaceId: WORKSPACE_ID, deadlineMs: 25_000, heartbeatTimeoutMs: 10_000, checks: [] })
    time.advance(9_000)
    const heartbeat = store.heartbeat(run.id, run.revision)
    expect(heartbeat).toMatchObject({ state: 'RUNNING', heartbeatDueAt: run.createdAt + 19_000 })
    time.advance(10_000)
    expect(store.get(run.id)).toMatchObject({ state: 'TIMED_OUT', terminalReason: 'HEARTBEAT_EXPIRED' })

    const second = store.create({ workspaceId: WORKSPACE_ID, deadlineMs: 12_000, heartbeatTimeoutMs: 10_000, checks: [] })
    time.advance(9_000)
    expect(store.heartbeat(second.id, second.revision).heartbeatDueAt).toBe(second.deadlineAt)
    time.advance(3_000)
    expect(store.get(second.id)).toMatchObject({ state: 'TIMED_OUT', terminalReason: 'DEADLINE_REACHED' })
  })

  it('rejects stale revisions and never changes a terminal outcome', () => {
    const store = new TaskRunStore()
    const run = store.create({ workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks: [] })
    const heartbeat = store.heartbeat(run.id, run.revision)
    expect(() => store.complete(run.id, run.revision, 'FAILED', [])).toThrow('unavailable or stale')
    const failed = store.complete(run.id, heartbeat.revision, 'FAILED', [])
    expect(failed).toMatchObject({ state: 'FAILED', terminalReason: 'CALLER_REPORTED_FAILURE' })
    expect(() => store.heartbeat(run.id, failed.revision)).toThrow('unavailable or stale')
  })

  it('publishes stable privacy-safe outcome reasons without claiming browser effects', () => {
    const store = new TaskRunStore()
    const create = (checks: Parameters<TaskRunStore['create']>[0]['checks'] = []) => store.create({
      workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks
    })
    const failed = create()
    const cancelled = create()
    const blocked = create()
    const rejected = create([{ id: 'page', type: 'page-settled', tabId: TAB_ID }])

    expect(store.complete(failed.id, failed.revision, 'FAILED', [])).toMatchObject({
      outcome: 'failed', reasonCode: 'CALLER_REPORTED_FAILURE', evidenceSource: 'caller-supplied', effects: 'not-established'
    })
    expect(store.complete(cancelled.id, cancelled.revision, 'CANCELLED', [])).toMatchObject({
      state: 'CANCELLED', outcome: 'cancelled', reasonCode: 'CALLER_REPORTED_CANCELLED',
      evidenceSource: 'caller-supplied', effects: 'not-established'
    })
    expect(store.complete(blocked.id, blocked.revision, 'BLOCKED', [])).toMatchObject({
      outcome: 'blocked', reasonCode: 'CALLER_REPORTED_BLOCKED', evidenceSource: 'caller-supplied'
    })
    expect(store.complete(rejected.id, rejected.revision, 'SUCCEEDED', [{ id: 'page', status: 'FAIL' }])).toMatchObject({
      state: 'BLOCKED', outcome: 'verifier-rejected', reasonCode: 'COMPLETION_CHECK_FAILED',
      evidenceSource: 'hronaut-observed', effects: 'not-established'
    })
    expect(JSON.stringify(store.snapshot())).not.toContain('caller-supplied')
  })

  it('fails closed when the monotonic clock rolls back', () => {
    const time = clock()
    const store = new TaskRunStore({ monotonicNow: time.monotonicNow, wallNow: time.wallNow })
    const run = store.create({ workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks: [] })
    time.rollback()
    expect(store.get(run.id)).toMatchObject({ state: 'OUTCOME_UNKNOWN', terminalReason: 'CLOCK_INVALID' })
  })

  it('does not partially mutate a heartbeat or outcome when the wall clock is invalid', () => {
    let wall = 1_800_000_000_000
    const store = new TaskRunStore({ monotonicNow: () => 1_000, wallNow: () => wall })
    const heartbeatRun = store.create({ workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks: [] })
    wall = Number.NaN
    expect(() => store.heartbeat(heartbeatRun.id, heartbeatRun.revision)).toThrow('clock unavailable')
    expect(store.get(heartbeatRun.id)).toMatchObject({
      revision: heartbeatRun.revision,
      state: 'RUNNING',
      heartbeatDueAt: heartbeatRun.heartbeatDueAt
    })

    wall = 1_800_000_000_000
    const outcomeRun = store.create({ workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks: [] })
    wall = Number.NaN
    expect(() => store.complete(outcomeRun.id, outcomeRun.revision, 'FAILED', [])).toThrow('clock unavailable')
    expect(store.get(outcomeRun.id)).toMatchObject({ revision: outcomeRun.revision, state: 'RUNNING', terminalReason: null })
  })

  it('restores active runs as unknown and preserves terminal history', () => {
    const time = clock()
    const original = new TaskRunStore({ monotonicNow: time.monotonicNow, wallNow: time.wallNow })
    const active = original.create({ workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks: [] })
    const terminal = original.create({ workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks: [] })
    original.complete(terminal.id, terminal.revision, 'BLOCKED', [])

    const restored = new TaskRunStore({ monotonicNow: time.monotonicNow, wallNow: time.wallNow })
    restored.restore(original.snapshot())
    expect(restored.get(active.id)).toMatchObject({ state: 'OUTCOME_UNKNOWN', terminalReason: 'RESTART' })
    expect(restored.get(terminal.id)).toMatchObject({ state: 'BLOCKED', terminalReason: 'CALLER_REPORTED_BLOCKED' })
  })

  it('restores an interrupted verification as an unknown outcome', () => {
    const original = new TaskRunStore()
    const active = original.create({
      workspaceId: WORKSPACE_ID,
      deadlineMs: 60_000,
      heartbeatTimeoutMs: 10_000,
      checks: [{ id: 'page', type: 'page-settled', tabId: TAB_ID }]
    })
    original.complete(active.id, active.revision, 'SUCCEEDED', [{ id: 'page', status: 'PASS' }])

    const restored = new TaskRunStore()
    restored.restore(original.snapshot())
    expect(restored.get(active.id)).toMatchObject({ state: 'OUTCOME_UNKNOWN', terminalReason: 'RESTART' })
  })

  it('evicts only the oldest terminal run at capacity', () => {
    const store = new TaskRunStore({ capacity: 2 })
    const active = store.create({ workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks: [] })
    const terminal = store.create({ workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks: [] })
    store.complete(terminal.id, terminal.revision, 'FAILED', [])
    const replacement = store.create({ workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks: [] })
    expect(store.list(WORKSPACE_ID).map(run => run.id)).toEqual([active.id, replacement.id])
    expect(() => store.create({ workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks: [] })).toThrow('capacity reached')
  })
})
