import { describe, expect, it } from 'vitest'
import { ImageInspectionSlots, normalizeImageState } from '../src/main/browser/image-state.js'
const report = () => ({ observedAt: 123, complete: true, naturalWidth: 0, naturalHeight: 0, hasSelectedSource: false })
describe('native image report', () => {
  it('retains native complete with no intrinsic dimensions without inventing readiness', () => {
    expect(normalizeImageState(report())).toEqual(report())
    expect(normalizeImageState({ ...report(), hasSelectedSource: true })).toEqual({ ...report(), hasSelectedSource: true })
  })
  it.each([{ currentSrc: 'private' }, { alt: 'private' }, { complete: 'true' }, { hasSelectedSource: 1 }, { naturalWidth: -1 }, { naturalWidth: Infinity }, { naturalWidth: 1.5 }, { naturalHeight: NaN }, { naturalHeight: 4294967296 }, { observedAt: -1 }, { observedAt: 0.5 }])('rejects invalid or extra fields %j', delta => {
    expect(() => normalizeImageState({ ...report(), ...delta })).toThrow('invalid native report')
  })
  it.each(['missing-target', 'ambiguous-target', 'invalid-selector', 'unsupported-target', 'unsupported-document', 'document-limit', 'native-unavailable', 'expired', 'busy'])('scrubs failure %s', failure => {
    expect(() => normalizeImageState({ failure })).toThrow()
    expect(() => normalizeImageState({ failure, source: 'PRIVATE' })).toThrow('invalid native report')
  })
})

it('retains all eight slots through unresolved native work and cleanup after closure', async () => {
  const slots = new ImageInspectionSlots(), owner = {}
  const operations = Array.from({ length: 8 }, () => {
    let finish!: () => void, clean!: () => void
    const lease = slots.acquire(owner)
    lease.track(new Promise<void>(resolve => { finish = resolve }))
    lease.close(new Promise<void>(resolve => { clean = resolve }))
    return { finish, clean, lease }
  })
  expect(() => slots.acquire(owner)).toThrow('busy')
  operations[0]!.finish(); await Promise.resolve()
  expect(() => slots.acquire(owner)).toThrow('busy')
  operations[0]!.clean(); await Promise.resolve()
  const replacement = slots.acquire(owner)
  expect(() => slots.acquire(owner)).toThrow('busy')
  operations[0]!.lease.close(); expect(() => slots.acquire(owner)).toThrow('busy')
  replacement.close()
  for (const operation of operations.slice(1)) { operation.finish(); operation.clean() }
  await Promise.resolve()
  const fresh = Array.from({ length: 8 }, () => slots.acquire(owner)); fresh.forEach(lease => lease.close())
})

it('isolates tab budgets and releases rejected operations only when settled', async () => {
  const slots = new ImageInspectionSlots(), owner = {}, other = {}
  const leases = Array.from({ length: 8 }, () => slots.acquire(owner))
  const separate = slots.acquire(other); separate.close()
  let reject!: (reason: Error) => void
  const pending = new Promise<void>((_resolve, fail) => { reject = fail })
  leases[0]!.track(pending); leases[0]!.close()
  expect(() => slots.acquire(owner)).toThrow('busy')
  reject(new Error('native destroyed')); await Promise.resolve()
  const replacement = slots.acquire(owner); replacement.close(); leases.slice(1).forEach(lease => lease.close())
})
