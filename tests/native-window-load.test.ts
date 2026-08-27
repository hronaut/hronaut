import { describe, expect, it, vi } from 'vitest'
import { loadNativeWindowWithRollback } from '../src/main/native-window-load.js'

function targetFixture(loadURL: () => Promise<void>) {
  return {
    loadURL: vi.fn(loadURL),
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn()
  }
}

describe('loadNativeWindowWithRollback', () => {
  it('releases a failed native window and its owner so a later open can retry', async () => {
    const loadFailure = new Error('panel renderer failed to load')
    const target = targetFixture(async () => { throw loadFailure })
    const resetOwner = vi.fn()

    await expect(loadNativeWindowWithRollback(target, 'file:///panel.html', resetOwner))
      .rejects.toBe(loadFailure)

    expect(resetOwner).toHaveBeenCalledOnce()
    expect(target.destroy).toHaveBeenCalledOnce()
  })

  it('keeps a successfully loaded window owned and alive', async () => {
    const target = targetFixture(async () => undefined)
    const resetOwner = vi.fn()

    await expect(loadNativeWindowWithRollback(target, 'file:///panel.html', resetOwner))
      .resolves.toBeUndefined()

    expect(resetOwner).not.toHaveBeenCalled()
    expect(target.destroy).not.toHaveBeenCalled()
  })

  it('does not destroy a window that Electron already destroyed while loading', async () => {
    const target = targetFixture(async () => { throw new Error('window closed') })
    target.isDestroyed.mockReturnValue(true)

    await expect(loadNativeWindowWithRollback(target, 'file:///panel.html', vi.fn()))
      .rejects.toThrow('window closed')

    expect(target.destroy).not.toHaveBeenCalled()
  })

  it('reports both load and native cleanup failures after releasing ownership', async () => {
    const loadFailure = new Error('panel renderer failed to load')
    const destroyFailure = new Error('native destroy failed')
    const target = targetFixture(async () => { throw loadFailure })
    target.destroy.mockImplementation(() => { throw destroyFailure })
    const resetOwner = vi.fn()

    const failure = await loadNativeWindowWithRollback(target, 'file:///panel.html', resetOwner)
      .then(() => undefined, (error: unknown) => error)

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([loadFailure, destroyFailure])
    expect(resetOwner).toHaveBeenCalledOnce()
  })
})
