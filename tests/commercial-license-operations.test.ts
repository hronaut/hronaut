import { describe, expect, it, vi } from 'vitest'
import { CommercialLicenseOperationCoordinator } from '../src/main/commercial-license-operations.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

describe('CommercialLicenseOperationCoordinator', () => {
  it('invalidates an older refresh as soon as a user mutation is requested', async () => {
    const coordinator = new CommercialLicenseOperationCoordinator()
    const network = deferred<void>()
    const applyRefresh = vi.fn()
    const refresh = coordinator.refresh(async (isCurrent) => {
      await network.promise
      if (isCurrent()) applyRefresh()
      return isCurrent()
    }, () => false)

    const mutation = coordinator.mutate(async () => 'activated')
    network.resolve()

    await expect(refresh).resolves.toBe(false)
    await expect(mutation).resolves.toBe('activated')
    expect(applyRefresh).not.toHaveBeenCalled()
  })

  it('skips background refreshes while a user mutation is running', async () => {
    const coordinator = new CommercialLicenseOperationCoordinator()
    const saving = deferred<void>()
    const mutation = coordinator.mutate(async () => {
      await saving.promise
      return 'saved'
    })
    const refresh = vi.fn(async () => true)
    const skipped = vi.fn(() => false)

    await expect(coordinator.refresh(refresh, skipped)).resolves.toBe(false)

    expect(refresh).not.toHaveBeenCalled()
    expect(skipped).toHaveBeenCalledOnce()
    saving.resolve()
    await mutation
  })

  it('serializes user mutations in invocation order even after a failure', async () => {
    const coordinator = new CommercialLicenseOperationCoordinator()
    const first = deferred<void>()
    const order: string[] = []
    const failed = coordinator.mutate(async () => {
      order.push('first-started')
      await first.promise
      order.push('first-failed')
      throw new Error('activation failed')
    })
    const second = coordinator.mutate(async () => {
      order.push('second')
      return 'deactivated'
    })

    expect(order).toEqual([])
    first.resolve()
    await expect(failed).rejects.toThrow('activation failed')
    await expect(second).resolves.toBe('deactivated')
    expect(order).toEqual(['first-started', 'first-failed', 'second'])
  })

  it('lets only the latest overlapping refresh apply', async () => {
    const coordinator = new CommercialLicenseOperationCoordinator()
    const firstNetwork = deferred<void>()
    const first = coordinator.refresh(async (isCurrent) => {
      await firstNetwork.promise
      return isCurrent() ? 'first-applied' : 'first-stale'
    }, () => 'first-skipped')
    const second = coordinator.refresh(async (isCurrent) => (
      isCurrent() ? 'second-applied' : 'second-stale'
    ), () => 'second-skipped')

    await expect(second).resolves.toBe('second-applied')
    firstNetwork.resolve()
    await expect(first).resolves.toBe('first-stale')
  })
})
