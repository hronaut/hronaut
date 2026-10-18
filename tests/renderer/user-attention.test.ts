import { describe, expect, it, vi } from 'vitest'
import { useUserAttention } from '../../src/renderer/src/composables/useUserAttention.js'
import type { UserAttentionRequest } from '../../src/shared/types.js'

function request(id: string): UserAttentionRequest {
  return { id, reason: `Request ${id}`, requestedAt: '2026-10-18T09:00:00.000Z' }
}

function harness() {
  let listener: ((next: UserAttentionRequest | null) => void) | undefined
  let answer: (initial: UserAttentionRequest | null) => void = () => undefined
  const unsubscribe = vi.fn()
  const browser = {
    onUserAttentionChanged: vi.fn((next: (request: UserAttentionRequest | null) => void) => {
      listener = next
      return unsubscribe
    }),
    getUserAttention: vi.fn(() => new Promise<UserAttentionRequest | null>((resolve) => { answer = resolve }))
  }
  const attention = useUserAttention(browser)
  return { attention, browser, unsubscribe, emit: (next: UserAttentionRequest | null) => listener?.(next), answer: (initial: UserAttentionRequest | null) => answer(initial) }
}

describe('useUserAttention', () => {
  it('listens before it asks, and fills in the first answer', async () => {
    const h = harness()
    expect(h.browser.onUserAttentionChanged.mock.invocationCallOrder[0]).toBeLessThan(h.browser.getUserAttention.mock.invocationCallOrder[0])
    expect(h.attention.request.value).toBeNull()
    h.answer(request('first'))
    await Promise.resolve()
    expect(h.attention.request.value?.id).toBe('first')
  })

  it('keeps a request that arrived before a late first answer', async () => {
    const h = harness()
    h.emit(request('newer'))
    h.answer(request('stale'))
    await Promise.resolve()
    expect(h.attention.request.value?.id).toBe('newer')
    // An ended request also stands over the late answer.
    const ended = harness()
    ended.emit(null)
    ended.answer(request('stale'))
    await Promise.resolve()
    expect(ended.attention.request.value).toBeNull()
  })

  it('stops listening when disposed', () => {
    const h = harness()
    h.attention.dispose()
    expect(h.unsubscribe).toHaveBeenCalledOnce()
  })
})
