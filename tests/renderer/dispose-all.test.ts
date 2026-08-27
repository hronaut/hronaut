import { describe, expect, it, vi } from 'vitest'
import { disposeAll } from '../../src/renderer/src/composables/dispose-all.js'

describe('disposeAll', () => {
  it('runs every callback before aggregating multiple cleanup failures', () => {
    const firstFailure = new Error('first cleanup failed')
    const secondFailure = new Error('second cleanup failed')
    const laterCleanup = vi.fn()
    let thrown: unknown

    try {
      disposeAll([
        () => { throw firstFailure },
        () => { throw secondFailure },
        laterCleanup
      ])
    } catch (error) {
      thrown = error
    }

    expect(laterCleanup).toHaveBeenCalledOnce()
    expect(thrown).toBeInstanceOf(AggregateError)
    expect((thrown as AggregateError).errors).toEqual([firstFailure, secondFailure])
  })
})
