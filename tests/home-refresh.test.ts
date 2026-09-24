import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { HomeRefresh } from '../src/main/browser/home-refresh.js'

function page() {
  return Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    isLoadingMainFrame: vi.fn(() => false),
    reload: vi.fn()
  })
}

describe('automatic Home refresh', () => {
  it('refreshes a loaded Home immediately', () => {
    const contents = page()
    new HomeRefresh().request(contents, () => true)
    expect(contents.reload).toHaveBeenCalledOnce()
  })

  it('lets the initial navigation finish and coalesces pending refreshes', () => {
    const contents = page()
    contents.isLoadingMainFrame.mockReturnValue(true)
    const refresh = new HomeRefresh()
    refresh.request(contents, () => true)
    refresh.request(contents, () => true)
    expect(contents.reload).not.toHaveBeenCalled()
    contents.isLoadingMainFrame.mockReturnValue(false)
    contents.emit('did-stop-loading')
    expect(contents.reload).toHaveBeenCalledOnce()
    expect(contents.listenerCount('destroyed')).toBe(0)
    contents.emit('did-stop-loading')
    expect(contents.reload).toHaveBeenCalledOnce()
    refresh.request(contents, () => true)
    expect(contents.reload).toHaveBeenCalledTimes(2)
  })

  it('discards a pending refresh when Home is replaced or navigates away', async () => {
    const contents = page()
    contents.isLoadingMainFrame.mockReturnValue(true)
    let current = true
    const operation = new HomeRefresh().request(contents, () => current)
    current = false
    contents.isLoadingMainFrame.mockReturnValue(false)
    contents.emit('did-stop-loading')
    expect(contents.reload).not.toHaveBeenCalled()
    expect(contents.eventNames()).toEqual([])
    await operation
  })

  it('releases listeners when the page is destroyed during navigation', async () => {
    const contents = page()
    contents.isLoadingMainFrame.mockReturnValue(true)
    const operation = new HomeRefresh().request(contents, () => true)
    contents.isDestroyed.mockReturnValue(true)
    contents.emit('destroyed')
    contents.emit('did-stop-loading')
    expect(contents.reload).not.toHaveBeenCalled()
    expect(contents.eventNames()).toEqual([])
    await operation
  })

  it('reports deferred reload failures to every waiting caller and allows recovery', async () => {
    const contents = page()
    contents.isLoadingMainFrame.mockReturnValue(true)
    const failure = new Error('Home reload failed')
    contents.reload.mockImplementationOnce(() => { throw failure })
    const refresh = new HomeRefresh()
    const first = refresh.request(contents, () => true)
    const second = refresh.request(contents, () => true)
    const results = Promise.allSettled([first, second])
    expect(() => contents.emit('did-stop-loading')).not.toThrow()
    expect(await results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure }
    ])
    expect(contents.eventNames()).toEqual([])
    contents.isLoadingMainFrame.mockReturnValue(false)
    await refresh.request(contents, () => true)
    expect(contents.reload).toHaveBeenCalledTimes(2)
  })

  it('reports immediate reload failures through the same promise contract', async () => {
    const contents = page()
    contents.reload.mockImplementationOnce(() => { throw new Error('Home reload failed') })
    await expect(new HomeRefresh().request(contents, () => true)).rejects.toThrow('Home reload failed')
  })

  it('ignores already destroyed or obsolete Home contents', () => {
    const contents = page()
    const refresh = new HomeRefresh()
    refresh.request(contents, () => false)
    contents.isDestroyed.mockReturnValue(true)
    refresh.request(contents, () => true)
    expect(contents.reload).not.toHaveBeenCalled()
  })
})
