import { describe, expect, it, vi } from 'vitest'
import { disposeAll, registerDisposers } from '../../src/renderer/src/composables/dispose-all.js'

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

  it('reports both registration and rollback failures after marking setup inactive', () => {
    const registrationFailure = new Error('registration failed')
    const rollbackFailure = new Error('rollback failed')
    const beforeRollback = vi.fn()
    let thrown: unknown

    try {
      registerDisposers([
        () => () => { throw rollbackFailure },
        () => { throw registrationFailure }
      ], beforeRollback)
    } catch (error) {
      thrown = error
    }

    expect(beforeRollback).toHaveBeenCalledOnce()
    expect(thrown).toBeInstanceOf(AggregateError)
    expect((thrown as AggregateError).errors).toEqual([registrationFailure, rollbackFailure])
  })
})
