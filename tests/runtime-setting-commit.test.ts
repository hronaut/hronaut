import { describe, expect, it, vi } from 'vitest'
import { commitRuntimeSetting } from '../src/main/runtime-setting-commit.js'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((next) => { resolve = next })
  return { promise, resolve }
}

describe('runtime setting commits', () => {
  it('applies runtime state before the persisted value can become visible', async () => {
    let runtimeToolSet = 'complete'
    const persistenceStarted = deferred()
    const releasePersistence = deferred()

    const commit = commitRuntimeSetting({
      previous: 'complete',
      next: 'qa',
      apply: (value) => { runtimeToolSet = value },
      persist: async () => {
        persistenceStarted.resolve()
        await releasePersistence.promise
      }
    })

    await persistenceStarted.promise
    const runtimeWhilePersistenceCanPublish = runtimeToolSet
    releasePersistence.resolve()
    await commit

    expect(runtimeWhilePersistenceCanPublish).toBe('qa')
  })

  it('restores runtime state when persistence fails', async () => {
    const apply = vi.fn<(value: string) => void>()

    await expect(commitRuntimeSetting({
      previous: 'complete',
      next: 'qa',
      apply,
      persist: async () => { throw new Error('disk unavailable') }
    })).rejects.toThrow('disk unavailable')

    expect(apply).toHaveBeenNthCalledWith(1, 'qa')
    expect(apply).toHaveBeenNthCalledWith(2, 'complete')
  })
})
