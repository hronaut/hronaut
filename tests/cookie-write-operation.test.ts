import { describe, expect, it, vi } from 'vitest'
import { cookieWriteFailure, createCookieWriteOperation, type CookieWriteProgress } from '../src/main/browser/cookie-write-operation.js'

describe('cookie write boundaries', () => {
  it('rejects before dispatch when authority is already invalid', async () => {
    const writes = vi.fn(async () => {})
    const progress = vi.fn()
    const operation = createCookieWriteOperation(() => { throw new Error('revoked') }, progress)
    await expect(operation.write(writes)).rejects.toThrow('revoked')
    expect(writes).not.toHaveBeenCalled()
    expect(progress).not.toHaveBeenCalled()
    expect(cookieWriteFailure({ attemptedWrites: 0, acknowledgedWrites: 0 })).toMatchObject({ status: 'NOT_DISPATCHED', effects: 'none', retrySafe: false })
  })

  it('retains an acknowledged first effect while stopping the remaining batch', async () => {
    let current = true
    const progress: CookieWriteProgress[] = []
    const operation = createCookieWriteOperation(() => { if (!current) throw new Error('revoked') }, p => progress.push(p))
    const second = vi.fn(async () => {})
    await expect(operation.write(async () => { current = false })).rejects.toThrow('revoked')
    await expect(operation.write(second)).rejects.toThrow('revoked')
    expect(second).not.toHaveBeenCalled()
    expect(progress).toEqual([{ attemptedWrites: 1, acknowledgedWrites: 0 }, { attemptedWrites: 1, acknowledgedWrites: 1 }])
    expect(cookieWriteFailure(progress.at(-1)!)).toMatchObject({ status: 'OUTCOME_UNKNOWN', effects: 'possible', retrySafe: false })
  })

  it('does not replay or expose native error details after a lost acknowledgement', async () => {
    const progress: CookieWriteProgress[] = []
    const operation = createCookieWriteOperation(() => {}, p => progress.push(p))
    const writes = vi.fn(async () => { throw new Error('private-native-cookie-detail') })
    await expect(operation.write(writes)).rejects.toThrow('Cookie writes may have taken effect')
    expect(writes).toHaveBeenCalledOnce()
    expect(progress).toEqual([{ attemptedWrites: 1, acknowledgedWrites: 0 }])
  })

  it('continues a normal batch and reports each native acknowledgement', async () => {
    const progress: CookieWriteProgress[] = []
    const operation = createCookieWriteOperation(() => {}, p => progress.push(p))
    const writes = vi.fn(async () => {})
    await operation.write(writes)
    await operation.write(writes)
    expect(writes).toHaveBeenCalledTimes(2)
    expect(progress.at(-1)).toEqual({ attemptedWrites: 2, acknowledgedWrites: 2 })
    expect(progress[0]).toEqual({ attemptedWrites: 1, acknowledgedWrites: 0 })
  })
})
