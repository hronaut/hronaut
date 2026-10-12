import { expect, it, vi } from 'vitest'
import { executeWebStorage, webStorageFailure, type WebStorageProgress } from '../src/main/browser/web-storage-operation.js'

it.each([false, true])('never submits execution after a pre-dispatch veto (mutation=%s)', async mutation => {
  const execute = vi.fn(async () => 'synthetic-value')
  const progress = vi.fn()
  await expect(executeWebStorage(mutation, () => { throw new Error('revoked') }, execute, progress)).rejects.toThrow('revoked')
  expect(execute).not.toHaveBeenCalled()
  expect(progress).not.toHaveBeenCalled()
  expect(webStorageFailure({ mutation, executionSubmitted: false, executionAcknowledged: false })).toMatchObject({ status: 'NOT_DISPATCHED', effects: 'none', retrySafe: false })
})

it.each([false, true])('withholds an acknowledged result after authority changes (mutation=%s)', async mutation => {
  let current = true
  const progress: WebStorageProgress[] = []
  const execute = vi.fn(async () => { current = false; return 'synthetic-value' })
  await expect(executeWebStorage(mutation, () => { if (!current) throw new Error('revoked') }, execute, p => progress.push(p))).rejects.toThrow('revoked')
  expect(execute).toHaveBeenCalledOnce()
  expect(progress).toEqual([{ mutation, executionSubmitted: true, executionAcknowledged: false }, { mutation, executionSubmitted: true, executionAcknowledged: true }])
  expect(webStorageFailure(progress.at(-1)!)).toMatchObject({ status: mutation ? 'OUTCOME_UNKNOWN' : 'STALE_OBSERVATION', effects: mutation ? 'possible' : 'none', retrySafe: false })
})

it.each([false, true])('scrubs rejected execution without replay or claiming acknowledgement (mutation=%s)', async mutation => {
  const progress: WebStorageProgress[] = []
  const execute = vi.fn(async () => { throw new Error('synthetic-private-renderer-value') })
  await expect(executeWebStorage(mutation, () => {}, execute, p => progress.push(p))).rejects.not.toThrow('synthetic-private-renderer-value')
  expect(execute).toHaveBeenCalledOnce()
  expect(progress).toEqual([{ mutation, executionSubmitted: true, executionAcknowledged: false }])
})

it.each([false, true])('returns unchanged results with execution provenance (mutation=%s)', async mutation => {
  const progress: WebStorageProgress[] = []
  await expect(executeWebStorage(mutation, () => {}, async () => 'synthetic-value', p => progress.push(p))).resolves.toBe('synthetic-value')
  expect(progress.at(-1)).toEqual({ mutation, executionSubmitted: true, executionAcknowledged: true })
})
