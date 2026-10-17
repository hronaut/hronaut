import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNDO_HOLD_MAX_MS, UndoOffers, type UndoableAction } from '../src/main/undo-offers.js'
import { isUndoToken, UNDO_OFFER_MS, type UndoOffer } from '../src/shared/undo.js'

/** Main ends an offer by itself this long after the toast's own time, when the toast never answers. */
const GRACE_MS = 4_000

function harness() {
  const offered: UndoOffer[] = []
  const ended: string[] = []
  const errors: { action: string; error: unknown }[] = []
  const offers = new UndoOffers(
    (offer) => { offered.push(offer) },
    (token) => { ended.push(token) },
    (action, error) => { errors.push({ action, error }) }
  )
  const action = (overrides: Partial<UndoableAction> = {}) => ({
    kind: 'tabs-closed' as const,
    name: 'Example',
    undo: vi.fn(async (): Promise<boolean | void> => true),
    finalize: vi.fn(async () => undefined),
    ...overrides
  })
  const latest = (): UndoOffer => offered.at(-1)!
  return { offers, offered, ended, errors, action, latest }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('UndoOffers', () => {
  it('publishes one offer with a fresh token, its kind, name and a count of one by default', () => {
    const { offers, offered, action } = harness()
    offers.offer(action({ kind: 'bookmark-removed', name: 'Docs' }))
    offers.offer(action({ kind: 'tabs-closed', name: 'Mail', count: 3 }))
    expect(offered).toHaveLength(2)
    expect(offered[0]).toEqual({ token: expect.any(String), kind: 'bookmark-removed', name: 'Docs', count: 1 })
    expect(offered[1]).toMatchObject({ kind: 'tabs-closed', name: 'Mail', count: 3 })
    expect(isUndoToken(offered[0]!.token)).toBe(true)
    expect(isUndoToken(offered[1]!.token)).toBe(true)
    expect(offered[1]!.token).not.toBe(offered[0]!.token)
  })

  it('ends a replaced offer: publishes its end, completes what it held back and no longer undoes it', async () => {
    const { offers, ended, action, latest } = harness()
    const first = action({ name: 'First' })
    offers.offer(first)
    const firstToken = latest().token
    const second = action({ name: 'Second' })
    offers.offer(second)
    await vi.advanceTimersByTimeAsync(0)
    expect(ended).toEqual([firstToken])
    expect(first.finalize).toHaveBeenCalledOnce()
    expect(await offers.undo(firstToken)).toBe(false)
    expect(first.undo).not.toHaveBeenCalled()
    // The newer offer is still the one shown.
    expect(second.finalize).not.toHaveBeenCalled()
    expect(await offers.undo(latest().token)).toBe(true)
    expect(second.undo).toHaveBeenCalledOnce()
  })

  it('undoes the current offer once, publishes its end and never completes what it held back', async () => {
    const { offers, ended, action, latest } = harness()
    const closed = action()
    offers.offer(closed)
    const { token } = latest()
    expect(await offers.undo(token)).toBe(true)
    expect(closed.undo).toHaveBeenCalledOnce()
    expect(ended).toEqual([token])
    // A second Undo, the toast closing afterwards or its timer finds nothing.
    expect(await offers.undo(token)).toBe(false)
    offers.finish(token)
    await vi.advanceTimersByTimeAsync(UNDO_HOLD_MAX_MS)
    expect(closed.undo).toHaveBeenCalledOnce()
    expect(closed.finalize).not.toHaveBeenCalled()
    expect(ended).toEqual([token])
  })

  it('reports nothing undone when the action put nothing back, and done when it returns nothing', async () => {
    const { offers, action, latest } = harness()
    offers.offer(action({ undo: vi.fn(async () => false) }))
    expect(await offers.undo(latest().token)).toBe(false)
    offers.offer(action({ undo: vi.fn(async () => undefined) }))
    expect(await offers.undo(latest().token)).toBe(true)
  })

  it('refuses an unknown token and an offer that already ended', async () => {
    const { offers, action, latest } = harness()
    const closed = action()
    offers.offer(closed)
    expect(await offers.undo('00000000-0000-4000-8000-000000000000')).toBe(false)
    const { token } = latest()
    await offers.end()
    expect(closed.finalize).toHaveBeenCalledOnce()
    expect(await offers.undo(token)).toBe(false)
    expect(closed.undo).not.toHaveBeenCalled()
  })

  it('ends an offer the toast never answers after its time plus the grace, not before', async () => {
    const { offers, ended, action, latest } = harness()
    const closed = action()
    offers.offer(closed)
    const { token } = latest()
    await vi.advanceTimersByTimeAsync(UNDO_OFFER_MS + GRACE_MS - 1)
    expect(ended).toEqual([])
    expect(closed.finalize).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(ended).toEqual([token])
    expect(closed.finalize).toHaveBeenCalledOnce()
    expect(await offers.undo(token)).toBe(false)
  })

  it('does not let a replaced offer\'s timer end the newer one', async () => {
    const { offers, ended, action, latest } = harness()
    offers.offer(action())
    const firstToken = latest().token
    await vi.advanceTimersByTimeAsync(5_000)
    const second = action()
    offers.offer(second)
    const secondToken = latest().token
    // The first offer's own expiry time passes.
    await vi.advanceTimersByTimeAsync(UNDO_OFFER_MS + GRACE_MS - 5_000)
    expect(ended).toEqual([firstToken])
    expect(second.finalize).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(ended).toEqual([firstToken, secondToken])
    expect(second.finalize).toHaveBeenCalledOnce()
  })

  it('holds the offer while the person is on the toast, for at most a minute from the hold', async () => {
    const { offers, ended, action, latest } = harness()
    const closed = action()
    offers.offer(closed)
    const { token } = latest()
    await vi.advanceTimersByTimeAsync(2_000)
    offers.hold(token)
    // Well past the toast's own time plus the grace, the offer is still there.
    await vi.advanceTimersByTimeAsync(UNDO_HOLD_MAX_MS - 1)
    expect(ended).toEqual([])
    expect(closed.finalize).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(ended).toEqual([token])
    expect(closed.finalize).toHaveBeenCalledOnce()
    expect(await offers.undo(token)).toBe(false)
  })

  it('ignores a hold or finish for an offer that is no longer the current one', async () => {
    const { offers, ended, action, latest } = harness()
    offers.offer(action())
    const staleToken = latest().token
    const current = action()
    offers.offer(current)
    const currentToken = latest().token
    offers.hold(staleToken)
    offers.finish(staleToken)
    await vi.advanceTimersByTimeAsync(0)
    expect(current.finalize).not.toHaveBeenCalled()
    // Without a hold of its own, the current offer keeps its normal expiry.
    await vi.advanceTimersByTimeAsync(UNDO_OFFER_MS + GRACE_MS)
    expect(ended).toEqual([staleToken, currentToken])
    expect(current.finalize).toHaveBeenCalledOnce()
  })

  it('ends the offer when the toast closes, publishing its end once even when its timer comes later', async () => {
    const { offers, ended, action, latest } = harness()
    const closed = action()
    offers.offer(closed)
    const { token } = latest()
    offers.finish(token)
    await vi.advanceTimersByTimeAsync(0)
    expect(ended).toEqual([token])
    expect(closed.finalize).toHaveBeenCalledOnce()
    offers.finish(token)
    await vi.advanceTimersByTimeAsync(UNDO_HOLD_MAX_MS)
    expect(ended).toEqual([token])
    expect(closed.finalize).toHaveBeenCalledOnce()
  })

  it('reports a failure to complete what an action held back without throwing', async () => {
    const { offers, ended, errors, action, latest } = harness()
    const failure = new Error('delete failed')
    offers.offer(action({ finalize: vi.fn(async () => { throw failure }) }))
    const { token } = latest()
    await expect(offers.end()).resolves.toBeUndefined()
    expect(ended).toEqual([token])
    expect(errors).toEqual([{ action: expect.any(String), error: failure }])
    // An action without anything held back ends quietly.
    offers.offer({ kind: 'tabs-closed', name: 'Tab', undo: async () => true })
    await expect(offers.end()).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
  })

  it('completes the current offer at quit and every offer made afterwards at once, without offering it', async () => {
    const { offers, offered, ended, action, latest } = harness()
    const pending = action()
    offers.offer(pending)
    const { token } = latest()
    await offers.close()
    expect(ended).toEqual([token])
    expect(pending.finalize).toHaveBeenCalledOnce()

    const late = action({ name: 'Closed during quit' })
    offers.offer(late)
    await vi.advanceTimersByTimeAsync(0)
    expect(late.finalize).toHaveBeenCalledOnce()
    expect(offered).toHaveLength(1)
    expect(ended).toEqual([token])
    expect(vi.getTimerCount()).toBe(0)
  })
})
