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

  it('discards a pending refresh when Home is replaced or navigates away', () => {
    const contents = page()
    contents.isLoadingMainFrame.mockReturnValue(true)
    let current = true
    new HomeRefresh().request(contents, () => current)
    current = false
    contents.isLoadingMainFrame.mockReturnValue(false)
    contents.emit('did-stop-loading')
    expect(contents.reload).not.toHaveBeenCalled()
    expect(contents.eventNames()).toEqual([])
  })

  it('releases listeners when the page is destroyed during navigation', () => {
    const contents = page()
    contents.isLoadingMainFrame.mockReturnValue(true)
    new HomeRefresh().request(contents, () => true)
    contents.isDestroyed.mockReturnValue(true)
    contents.emit('destroyed')
    contents.emit('did-stop-loading')
    expect(contents.reload).not.toHaveBeenCalled()
    expect(contents.eventNames()).toEqual([])
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
