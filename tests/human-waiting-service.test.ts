import { describe, expect, it, vi } from 'vitest'
import { HumanWaitingService } from '../src/main/mcp/human-waiting-service.js'
import { HumanWaitingStore } from '../src/main/mcp/human-waiting-store.js'

const input = {
  workspaceId: '0198dc5b-4192-7000-8000-000000000001', runId: '0198dc5b-4192-7000-8000-000000000002',
  decision: 'review-page' as const, owner: 'local-operator', fallbackOwner: 'local-operator',
  timeoutMs: 60_000, priorOutcome: 'OUTCOME_UNKNOWN' as const
}
const authorize = () => undefined

describe('durable waiting owner', () => {
  it('does not admit dispatch when expiry cannot be saved', async () => {
    let now = 0
    let saves = 0
    const service = new HumanWaitingService({ load: async () => null, save: async () => { if (++saves === 2) throw new Error('disk unavailable') } }, new HumanWaitingStore({ monotonicNow: () => now }))
    await service.create({ ...input, timeoutMs: 1000 }, authorize)
    now = 1000
    await expect(service.requireDispatch(input.workspaceId, authorize)).rejects.toThrow(/could not be saved/i)
    await expect(service.requireDispatch(input.workspaceId, authorize)).rejects.toThrow(/unavailable/i)
  })

  it('persists expiry observed by dispatch without rewriting unchanged history', async () => {
    let now = 0
    let saved: ReturnType<HumanWaitingStore['snapshot']> | undefined
    const save = vi.fn(async (snapshot: ReturnType<HumanWaitingStore['snapshot']>) => { saved = structuredClone(snapshot) })
    const service = new HumanWaitingService({ load: async () => null, save }, new HumanWaitingStore({ monotonicNow: () => now, wallNow: () => 1_000_000 }))
    await service.create({ ...input, timeoutMs: 1000 }, authorize)
    await expect(service.requireDispatch(input.workspaceId, authorize)).rejects.toThrow(/waiting for a human/i)
    expect(save).toHaveBeenCalledTimes(1)
    now = 1000
    await service.requireDispatch(input.workspaceId, authorize)
    const restored = new HumanWaitingStore({ monotonicNow: () => 0, wallNow: () => 1_000_000 })
    restored.restore(saved)
    expect(restored.list(input.workspaceId)[0]?.state).toBe('EXPIRED')
    await service.requireDispatch(input.workspaceId, authorize)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('keeps waiting when browser state changes while resolution is persisted', async () => {
    let saves = 0
    let changed = false
    const service = new HumanWaitingService({ load: async () => null, save: async () => { if (++saves === 2) changed = true } })
    const record = await service.create(input, authorize)
    await expect(service.change(input.workspaceId, record.id, record.revision, 'resolve', authorize, async () => {
      if (changed) throw new Error('browser changed')
    })).rejects.toThrow(/review/i)
    expect((await service.list(input.workspaceId, authorize))[0]).toMatchObject({ state: 'WAITING_FOR_HUMAN', priorOutcome: 'OUTCOME_UNKNOWN' })
    await expect(service.requireDispatch(input.workspaceId, authorize)).rejects.toThrow(/waiting for a human/i)
  })

  it('does not deliver an alert after its admission save crosses the deadline', async () => {
    let now = 0
    let saves = 0
    const service = new HumanWaitingService({ load: async () => null, save: async () => { if (++saves === 2) now = 2000 } }, new HumanWaitingStore({ monotonicNow: () => now }))
    const record = await service.create({ ...input, timeoutMs: 1000 }, authorize)
    const deliver = vi.fn(async () => undefined)
    expect(await service.notify(input.workspaceId, record.id, authorize, deliver)).toMatchObject({ state: 'EXPIRED', notificationStatus: 'failed' })
    expect(deliver).not.toHaveBeenCalled()
  })

  it('does not send another alert after a human acknowledgment', async () => {
    const service = new HumanWaitingService({ load: async () => null, save: async () => undefined })
    const record = await service.create(input, authorize)
    await service.change(input.workspaceId, record.id, record.revision, 'acknowledge', authorize)
    const deliver = vi.fn(async () => undefined)
    await expect(service.notify(input.workspaceId, record.id, authorize, deliver)).rejects.toThrow(/notification/i)
    expect(deliver).not.toHaveBeenCalled()
  })

  it('records alert failures without acknowledging the human decision', async () => {
    const service = new HumanWaitingService({ load: async () => null, save: async () => undefined })
    const record = await service.create(input, authorize)
    const reported = await service.notify(input.workspaceId, record.id, authorize, async () => { throw new Error('alert failed') })
    expect(reported).toMatchObject({ state: 'WAITING_FOR_HUMAN', notificationAttempts: 1, notificationStatus: 'failed' })
    await expect(service.requireDispatch(input.workspaceId, authorize)).rejects.toThrow(/waiting for a human/i)
  })

  it('records notification admission before delivery and never alerts after a failed save', async () => {
    const persistence = { load: async () => null, save: vi.fn(async () => undefined) }
    const service = new HumanWaitingService(persistence)
    const record = await service.create(input, authorize)
    persistence.save.mockRejectedValueOnce(new Error('disk failed'))
    const deliver = vi.fn(async () => undefined)
    await expect(service.notify(input.workspaceId, record.id, authorize, deliver)).rejects.toThrow(/could not be saved/i)
    expect(deliver).not.toHaveBeenCalled()
  })

  it('blocks dispatch while waiting or acknowledged without blocking another workspace', async () => {
    const service = new HumanWaitingService({ load: async () => null, save: async () => undefined })
    const record = await service.create(input, authorize)
    await expect(service.requireDispatch(input.workspaceId, authorize)).rejects.toThrow(/waiting for a human/i)
    await expect(service.requireDispatch('0198dc5b-4192-7000-8000-000000000003', authorize)).resolves.toBeUndefined()
    const acknowledged = await service.change(input.workspaceId, record.id, record.revision, 'acknowledge', authorize)
    await expect(service.requireDispatch(input.workspaceId, authorize)).rejects.toThrow(/waiting for a human/i)
    await service.change(input.workspaceId, record.id, acknowledged.revision, 'resolve', authorize, async () => undefined)
    await expect(service.requireDispatch(input.workspaceId, authorize)).resolves.toBeUndefined()
  })

  it('does not bypass authorization even when no decisions are pending', async () => {
    const service = new HumanWaitingService({ load: async () => null, save: async () => undefined })
    await expect(service.requireDispatch(input.workspaceId, () => { throw new Error('revoked') })).rejects.toThrow('revoked')
  })

  it('does not replace corrupt persisted history with an empty dispatch state', async () => {
    const persistence = { load: vi.fn(async () => { throw new Error('private malformed history') }), save: vi.fn(async () => undefined) }
    const service = new HumanWaitingService(persistence)
    await expect(service.requireDispatch(input.workspaceId, authorize)).rejects.toThrow('Human waiting history is unavailable')
    await expect(service.list(input.workspaceId, authorize)).rejects.toThrow('Human waiting history is unavailable')
    expect(persistence.load).toHaveBeenCalledTimes(1)
    expect(persistence.save).not.toHaveBeenCalled()
  })

  it('captures request metadata before queuing asynchronous initialization', async () => {
    const service = new HumanWaitingService({ load: async () => null, save: async () => undefined })
    const request = { ...input }
    const pending = service.create(request, authorize)
    request.owner = 'changed-after-submission'
    expect((await pending).owner).toBe(input.owner)
  })

  it('does not report a live wait after persistence outlasts its deadline', async () => {
    let now = 0
    const store = new HumanWaitingStore({ monotonicNow: () => now })
    const service = new HumanWaitingService({ load: async () => null, save: async () => { now = 2000 } }, store)
    expect(await service.create({ ...input, timeoutMs: 1000 }, authorize)).toMatchObject({ state: 'EXPIRED' })
  })

  it('rejects queued stale acknowledgments after saving the first change', async () => {
    const persistence = { load: vi.fn(async () => null), save: vi.fn(async () => undefined) }
    const service = new HumanWaitingService(persistence)
    const record = await service.create(input, authorize)
    const results = await Promise.allSettled([
      service.change(input.workspaceId, record.id, record.revision, 'acknowledge', authorize),
      service.change(input.workspaceId, record.id, record.revision, 'acknowledge', authorize)
    ])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(persistence.save).toHaveBeenCalledTimes(2)
  })

  it('blocks subsequent reads and changes after an uncertain persistence failure', async () => {
    const persistence = { load: vi.fn(async () => null), save: vi.fn(async () => { throw new Error('private path') }) }
    const service = new HumanWaitingService(persistence)
    await expect(service.create(input, authorize)).rejects.toThrow('Human waiting change could not be saved')
    await expect(service.list(input.workspaceId, authorize)).rejects.toThrow('Human waiting history is unavailable')
    expect(persistence.save).toHaveBeenCalledTimes(1)
  })

  it('requires fresh context and checks ownership after its asynchronous review', async () => {
    const persistence = { load: vi.fn(async () => null), save: vi.fn(async () => undefined) }
    const service = new HumanWaitingService(persistence)
    const record = await service.create(input, authorize)
    await expect(service.change(input.workspaceId, record.id, record.revision, 'resolve', authorize)).rejects.toThrow(/review/i)
    let allowed = true
    const check = () => { if (!allowed) throw new Error('revoked') }
    await expect(service.change(input.workspaceId, record.id, record.revision, 'resolve', check, async () => { allowed = false })).rejects.toThrow('revoked')
    expect((await service.list(input.workspaceId, authorize))[0]?.state).toBe('WAITING_FOR_HUMAN')
  })
})
