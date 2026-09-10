import { expect, it, vi } from 'vitest'
import { runPostWriteVerification } from '../src/main/mcp/post-write-verification-runner.js'

const contextFingerprint = 'a'.repeat(64)
const base = {
  actionId: '0198dc5b-4192-7000-8000-000000000001', transport: 'succeeded' as const,
  contextFingerprint, timeoutMs: 1_000, maxAttempts: 3, initialDelayMs: 100
}

it('persists each delayed observation in order and never invokes a mutation callback', async () => {
  let now = 0
  const read = vi.fn()
    .mockResolvedValueOnce('not-yet-visible')
    .mockResolvedValueOnce('matches')
  const observed: string[] = []
  const timeline = await runPostWriteVerification({
    contract: base, read, now: () => now,
    sleep: async delay => { now += delay },
    onEvent: async event => { observed.push(`${event.attempt}:${event.state}`) }
  })
  expect(read).toHaveBeenCalledTimes(2)
  expect(observed).toEqual(['1:not-yet-visible', '2:verified'])
  expect(timeline.at(-1)?.state).toBe('verified')
})

it('cancels during backoff without making another read', async () => {
  let now = 0
  const controller = new AbortController()
  const read = vi.fn(async () => 'not-yet-visible' as const)
  const timeline = await runPostWriteVerification({
    contract: base, read, signal: controller.signal, now: () => now,
    sleep: async delay => { now += delay; controller.abort() },
    onEvent: async () => undefined
  })
  expect(read).toHaveBeenCalledTimes(1)
  expect(timeline.at(-1)).toMatchObject({ state: 'unknown', reason: 'cancelled' })
})

it('records unavailable and context-changed reads as terminal unknown outcomes', async () => {
  for (const evidence of ['unavailable', 'context-changed'] as const) {
    const events: string[] = []
    await runPostWriteVerification({
      contract: base, read: async () => evidence,
      onEvent: async event => { events.push(event.reason) }
    })
    expect(events).toEqual([evidence === 'unavailable' ? 'read-unavailable' : 'context-changed'])
  }
})
