import { describe, expect, it, vi } from 'vitest'
import { TaskRunService } from '../src/main/mcp/task-run-service.js'
import { TaskRunStore } from '../src/main/mcp/task-run-store.js'

const WORKSPACE_ID = '018f4d10-7b4a-7000-8000-000000000001'
const TAB_ID = '018f4d10-7b4a-7000-8000-000000000002'
const request = {
  workspaceId: WORKSPACE_ID,
  deadlineMs: 60_000,
  heartbeatTimeoutMs: 10_000,
  checks: [{ id: 'page', type: 'page-settled' as const, tabId: TAB_ID }]
}
const authorize = () => undefined

describe('durable task-run owner', () => {
  it('persists admission before returning and rejects queued stale heartbeats', async () => {
    const persistence = { load: vi.fn(async () => null), save: vi.fn(async () => undefined) }
    const service = new TaskRunService(persistence)
    const run = await service.create(request, authorize)
    expect(persistence.save).toHaveBeenCalledTimes(1)
    const results = await Promise.allSettled([
      service.heartbeat(WORKSPACE_ID, run.id, run.revision, authorize),
      service.heartbeat(WORKSPACE_ID, run.id, run.revision, authorize)
    ])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
  })

  it('derives success from trusted current checks and rechecks authorization after evaluation', async () => {
    const service = new TaskRunService({ load: async () => null, save: async () => undefined })
    const run = await service.create(request, authorize)
    let allowed = true
    const check = () => { if (!allowed) throw new Error('revoked') }
    await expect(service.complete(WORKSPACE_ID, run.id, run.revision, 'SUCCEEDED', check, async checks => {
      expect(checks).toEqual(request.checks)
      allowed = false
      return { results: [{ id: 'page', status: 'PASS' }], contextToken: 'before' }
    })).rejects.toThrow('revoked')
    expect((await service.get(WORKSPACE_ID, run.id, authorize)).state).toBe('RUNNING')
  })

  it('reclassifies a saved success when its browser evidence changes before return', async () => {
    const service = new TaskRunService({ load: async () => null, save: async () => undefined })
    const run = await service.create(request, authorize)
    let evaluation = 0
    expect(await service.complete(WORKSPACE_ID, run.id, run.revision, 'SUCCEEDED', authorize, async () => ({
      results: [{ id: 'page', status: 'PASS' }],
      contextToken: `context-${++evaluation}`
    }))).toMatchObject({ state: 'OUTCOME_UNKNOWN', terminalReason: 'COMPLETION_CONTEXT_CHANGED' })
  })

  it('does not replace corrupt history with an empty usable state', async () => {
    const service = new TaskRunService({
      load: async () => { throw new Error('private malformed history') },
      save: async () => undefined
    })
    await expect(service.list(WORKSPACE_ID, authorize)).rejects.toThrow('Task-run history is unavailable')
    await expect(service.create(request, authorize)).rejects.toThrow('Task-run history is unavailable')
  })

  it('persists expiry observed by a read', async () => {
    let now = 0
    let saved: ReturnType<TaskRunStore['snapshot']> | undefined
    const save = vi.fn(async (snapshot: ReturnType<TaskRunStore['snapshot']>) => { saved = structuredClone(snapshot) })
    const store = new TaskRunStore({ monotonicNow: () => now, wallNow: () => 1_000_000 + now })
    const service = new TaskRunService({ load: async () => null, save }, store)
    const run = await service.create({ ...request, heartbeatTimeoutMs: 1_000 }, authorize)
    now = 1_000
    expect(await service.get(WORKSPACE_ID, run.id, authorize)).toMatchObject({ state: 'TIMED_OUT' })
    const restored = new TaskRunStore({ monotonicNow: () => 0, wallNow: () => 1_001_000 })
    restored.restore(saved)
    expect(restored.get(run.id)).toMatchObject({ state: 'TIMED_OUT', terminalReason: 'HEARTBEAT_EXPIRED' })
  })

  it('persists a second expiry observed after an earlier timeout save', async () => {
    let now = 0
    let saved: ReturnType<TaskRunStore['snapshot']> | undefined
    let advanceDuringSave = false
    const save = vi.fn(async (snapshot: ReturnType<TaskRunStore['snapshot']>) => {
      saved = structuredClone(snapshot)
      if (advanceDuringSave) {
        now += 1
        advanceDuringSave = false
      }
    })
    const store = new TaskRunStore({ monotonicNow: () => now, wallNow: () => 1_000_000 + now })
    const service = new TaskRunService({ load: async () => null, save }, store)
    await service.create({ ...request, heartbeatTimeoutMs: 1_000 }, authorize)
    await service.create({ ...request, heartbeatTimeoutMs: 1_001 }, authorize)

    now = 1_000
    advanceDuringSave = true
    expect(await service.list(WORKSPACE_ID, authorize)).toEqual([
      expect.objectContaining({ state: 'TIMED_OUT', terminalReason: 'HEARTBEAT_EXPIRED' }),
      expect.objectContaining({ state: 'TIMED_OUT', terminalReason: 'HEARTBEAT_EXPIRED' })
    ])
    expect(saved?.records).toEqual([
      expect.objectContaining({ state: 'TIMED_OUT' }),
      expect.objectContaining({ state: 'TIMED_OUT' })
    ])
  })

  it('blocks all later operations after an uncertain persistence failure', async () => {
    const service = new TaskRunService({ load: async () => null, save: async () => { throw new Error('private disk path') } })
    await expect(service.create(request, authorize)).rejects.toThrow('could not be saved')
    await expect(service.list(WORKSPACE_ID, authorize)).rejects.toThrow('history is unavailable')
  })
})
