import { expect, it } from 'vitest'
import { PostWriteVerification, type VerificationContract } from '../src/main/mcp/post-write-verification.js'

const context = 'a'.repeat(64)
const contract: VerificationContract = { actionId: '0198dc5b-4192-7000-8000-000000000001', transport: 'succeeded', contextFingerprint: context, timeoutMs: 1000, maxAttempts: 3, initialDelayMs: 100 }

it('reports deadline expiry even when no further read is attempted', () => {
  let now = 0
  const model = new PostWriteVerification(contract, () => now)
  now = 1000
  expect(model.timeline().at(-1)).toMatchObject({ state: 'unknown', reason: 'deadline' })
})

it('rejects invalid adapter evidence without consuming its pending attempt', () => {
  const model = new PostWriteVerification(contract, () => 0)
  const attempt = model.beginRead(context)!
  expect(() => model.finishRead(attempt, 'success' as never, context)).toThrow()
  model.finishRead(attempt, 'matches', context)
  expect(model.timeline().at(-1)?.state).toBe('verified')
})

it('preserves delayed visibility evidence when a later bounded read verifies the postcondition', () => {
  let now = 0
  const model = new PostWriteVerification(contract, () => now)
  model.finishRead(model.beginRead(context)!, 'not-yet-visible', context)
  expect(model.beginRead(context)).toBeNull()
  now = 100
  model.finishRead(model.beginRead(context)!, 'matches', context)
  expect(model.timeline().map(event => event.state)).toEqual(['pending', 'not-yet-visible', 'verified'])
  expect(model.beginRead(context)).toBeNull()
  expect(JSON.stringify(model.timeline())).not.toContain(context)
})

it.each(['ambiguous', 'failed'] as const)('does not promote %s transport or admit a new read', transport => {
  const model = new PostWriteVerification({ ...contract, transport }, () => 0)
  expect(model.beginRead(context)).toBeNull()
  model.finishRead('late', 'matches', context)
  expect(model.timeline().at(-1)?.state).toBe('unknown')
})

it.each(['deadline', 'context', 'rollback'] as const)('rejects matching evidence after %s invalidation', cause => {
  let now = 10
  const model = new PostWriteVerification(contract, () => now)
  const attempt = model.beginRead(context)!
  now = cause === 'deadline' ? 1010 : cause === 'rollback' ? 9 : 11
  model.finishRead(attempt, 'matches', cause === 'context' ? 'b'.repeat(64) : context)
  expect(model.timeline().at(-1)?.state).toBe('unknown')
})

it('bounds attempts, serializes reads and rejects stale evidence', () => {
  const model = new PostWriteVerification({ ...contract, maxAttempts: 1 }, () => 0)
  const attempt = model.beginRead(context)!
  expect(() => model.beginRead(context)).toThrow(/already pending/)
  expect(() => model.finishRead('stale', 'matches', context)).toThrow(/unavailable/)
  model.finishRead(attempt, 'not-yet-visible', context)
  expect(model.timeline().at(-1)?.reason).toBe('attempt-limit')
  expect(model.beginRead(context)).toBeNull()
})

it('keeps cancellation terminal and returned history isolated', () => {
  const model = new PostWriteVerification(contract, () => 0)
  const attempt = model.beginRead(context)!
  model.cancel()
  model.finishRead(attempt, 'matches', context)
  model.timeline().splice(0)
  expect(model.timeline().at(-1)?.reason).toBe('cancelled')
})
