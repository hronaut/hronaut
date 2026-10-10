import { describe, expect, it, vi, afterEach } from 'vitest'
import { UserAttentionLifecycle } from '../src/main/user-attention-lifecycle.js'
const request = { id: 'request-1', workspaceId: 'workspace-1', tabId: 'tab-1', reason: 'Manual step', requestedAt: '2026-10-10T00:00:00Z' }
const authorize = () => undefined

afterEach(() => vi.useRealTimers())
describe('explicit human attention resolution', () => {
  it('keeps acknowledgement and dismissal distinct from resolution', async () => {
    const owner = new UserAttentionLifecycle()
    owner.request(request)
    owner.acknowledge(request.id, 'acknowledged')
    expect(owner.forTab('tab-1', 'workspace-1')?.id).toBe(request.id)
    owner.acknowledge(request.id, 'dismissed')
    expect(owner.status(request.id, 'workspace-1').state).toBe('dismissed')
    const waiting = owner.wait(request.id, 'workspace-1', 1000, authorize)
    expect(owner.resolve(request.id, 'tab-2', 'workspace-1')).toBe(false)
    expect(owner.resolve(request.id, 'tab-1', 'workspace-1')).toBe(true)
    expect((await waiting).outcome).toBe('resolved')
    expect(owner.resolve(request.id, 'tab-1', 'workspace-1')).toBe(false)
    expect(owner.forTab('tab-1', 'workspace-1')).toBeUndefined()
  })
  it('does not let a stale menu resolve a newer request or another workspace', async () => {
    const owner = new UserAttentionLifecycle()
    owner.request(request)
    const waiting = owner.wait(request.id, 'workspace-1', 1000, authorize)
    owner.request({ ...request, id: 'request-2' })
    expect((await waiting).outcome).toBe('superseded')
    expect(owner.resolve(request.id, 'tab-1', 'workspace-1')).toBe(false)
    expect(owner.resolve('request-2', 'tab-1', 'workspace-2')).toBe(false)
    expect(owner.status('request-2', 'workspace-1').state).toBe('pending')
    expect(() => owner.status('request-2', 'workspace-2')).toThrow(/unavailable/)
  })
  it('observes resolution before waiting and supports concurrent waiters', async () => {
    const owner = new UserAttentionLifecycle()
    owner.request(request)
    const first = owner.wait(request.id, 'workspace-1', 1000, authorize)
    const second = owner.wait(request.id, 'workspace-1', 1000, authorize)
    owner.resolve(request.id, 'tab-1', 'workspace-1')
    expect((await first).outcome).toBe('resolved')
    expect((await second).outcome).toBe('resolved')
    expect((await owner.wait(request.id, 'workspace-1', 1000, authorize)).outcome).toBe('resolved')
  })
  it('times out without resolving and cleans up cancelled wait timers', async () => {
    vi.useFakeTimers()
    const owner = new UserAttentionLifecycle()
    owner.request(request)
    const pending = owner.wait(request.id, 'workspace-1', 10, authorize)
    await vi.advanceTimersByTimeAsync(10)
    expect((await pending).outcome).toBe('timed-out')
    expect(owner.status(request.id, 'workspace-1').state).toBe('pending')
    const controller = new AbortController()
    const cancelled = owner.wait(request.id, 'workspace-1', 1000, authorize, controller.signal)
    const rejection = expect(cancelled).rejects.toThrow(/cancelled/)
    controller.abort()
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rechecks authorization during a pending wait', async () => {
    vi.useFakeTimers()
    const owner = new UserAttentionLifecycle()
    owner.request(request)
    let permitted = true
    const waiting = owner.wait(request.id, 'workspace-1', 1000, () => { if (!permitted) throw new Error('Access revoked') })
    const rejection = expect(waiting).rejects.toThrow('Access revoked')
    permitted = false
    await vi.advanceTimersByTimeAsync(250)
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })
  it('invalidates moved tabs and removed workspaces without resolving unrelated state', () => {
    const owner = new UserAttentionLifecycle()
    owner.request(request)
    owner.reconcile([{ id: 'tab-1', mcpGroupId: 'workspace-2' }], ['workspace-1', 'workspace-2'])
    expect(owner.status(request.id, 'workspace-1').state).toBe('target-closed')
    expect(owner.resolve(request.id, 'tab-1', 'workspace-2')).toBe(false)
    owner.request({ ...request, id: 'request-2' })
    owner.reconcile([], [])
    expect(owner.status('request-2', 'workspace-1').state).toBe('workspace-removed')
  })
  it('rejects cancelled admission and invalid timeouts without leaking timers', async () => {
    vi.useFakeTimers()
    const owner = new UserAttentionLifecycle()
    owner.request(request)
    const controller = new AbortController(); controller.abort()
    await expect(owner.wait(request.id, 'workspace-1', 1000, authorize, controller.signal)).rejects.toThrow(/cancelled/)
    for (const timeout of [0, -1, 60_001, 1.5]) expect(() => owner.wait(request.id, 'workspace-1', timeout, authorize)).toThrow(/timeout/)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects reused identity without superseding its current request', () => {
    const owner = new UserAttentionLifecycle()
    owner.request(request)
    expect(() => owner.request(request)).toThrow(/reused/)
    expect(owner.status(request.id, 'workspace-1').state).toBe('pending')
  })
  it('distinguishes closed targets and expires bounded history', async () => {
    let now = 0
    const owner = new UserAttentionLifecycle(() => now)
    owner.request(request)
    const waiting = owner.wait(request.id, 'workspace-1', 1000, authorize)
    owner.reconcile([], ['workspace-1'])
    expect((await waiting).outcome).toBe('target-closed')
    owner.request({ ...request, id: 'request-2' })
    now = 86_400_001
    expect(owner.status('request-2', 'workspace-1').state).toBe('expired')
    for (let i = 0; i < 105; i++) owner.request({ ...request, id: `bounded-${i}` })
    expect(() => owner.status(request.id, 'workspace-1')).toThrow(/unavailable/)
  })
})
