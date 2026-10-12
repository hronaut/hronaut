import { expect, it, vi } from 'vitest'
import { storageInspectionFailure, storageInspectionGuard } from '../src/main/browser/storage-inspection-operation.js'

it('retains an authority veto even when the next validation would succeed', () => {
  const validate = vi.fn().mockImplementationOnce(() => { throw new Error('private authority context') })
  const guard = storageInspectionGuard(validate)
  expect(guard).toThrow('Storage observation was withheld')
  expect(guard).toThrow('Storage observation was withheld')
  expect(validate).toHaveBeenCalledOnce()
  expect(storageInspectionFailure()).toMatchObject({ status: 'STALE_OBSERVATION', effects: 'none', retrySafe: false })
})

it('checks current authority on every successful read and publication boundary', () => {
  const validate = vi.fn()
  const guard = storageInspectionGuard(validate)
  guard()
  guard()
  validate.mockImplementationOnce(() => { throw undefined })
  expect(guard).toThrow('Storage observation was withheld')
  expect(guard).toThrow('Storage observation was withheld')
  expect(validate).toHaveBeenCalledTimes(3)
})
