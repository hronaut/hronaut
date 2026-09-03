import { describe, expect, it, vi } from 'vitest'
import { runBackgroundAction } from '../src/main/browser/background-action.js'

describe('runBackgroundAction', () => {
  it('contains rejected lifecycle work and reports it without rejecting', async () => {
    const failure = new Error('approval persistence failed')
    const onFailure = vi.fn()

    await expect(runBackgroundAction(
      'cancel wallet requests after tab navigation',
      () => Promise.reject(failure),
      onFailure
    )).resolves.toBeUndefined()
    expect(onFailure).toHaveBeenCalledWith('cancel wallet requests after tab navigation', failure)
  })
})
