import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContentsView } from 'electron'
import { reconcilePresentedViewVisibility, watchPresentedViewVisibility } from '../src/main/browser/presented-view-visibility.js'

function fixture() {
  vi.stubGlobal('process', { ...process, platform: 'linux', versions: { ...process.versions, electron: '44.2.0' } })
  let resolve!: (visibility: string) => void
  const contents = {
    isDestroyed: vi.fn(() => false),
    isLoadingMainFrame: vi.fn(() => false),
    executeJavaScriptInIsolatedWorld: vi.fn(() => new Promise<string>(done => { resolve = done })),
    setEmbedder: vi.fn()
  }
  const view = { webContents: contents, getVisible: vi.fn(() => true) }
  const window = {
    isDestroyed: vi.fn(() => false), isVisible: vi.fn(() => true), isMinimized: vi.fn(() => false),
    webContents: {}, contentView: { children: [view] }
  }
  return { contents, view, window, resolve: (value: string) => resolve(value),
    reconcile: () => reconcilePresentedViewVisibility(window as unknown as BrowserWindow, view as unknown as WebContentsView) }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('presented view visibility', () => {
  it('checks idle visible pages, skips hidden hosts and stops cleanly', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const views = vi.fn(() => [f.view as unknown as WebContentsView])
    const stop = watchPresentedViewVisibility(f.window as unknown as BrowserWindow, views)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(f.contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(1)
    f.resolve('hidden')
    await vi.advanceTimersByTimeAsync(0)
    expect(f.contents.setEmbedder).toHaveBeenCalledTimes(1)
    f.window.isVisible.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(views).toHaveBeenCalledTimes(1)
    f.window.isVisible.mockReturnValue(true)
    stop()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(views).toHaveBeenCalledTimes(1)
  })

  it('coalesces checks and repairs only a hidden renderer', async () => {
    const f = fixture()
    f.reconcile()
    f.reconcile()
    expect(f.contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(1)
    f.resolve('hidden')
    await vi.waitFor(() => expect(f.contents.setEmbedder).toHaveBeenCalledWith(f.window.webContents))
  })

  it('leaves a healthy renderer alone', async () => {
    const f = fixture()
    f.reconcile()
    f.resolve('visible')
    await Promise.resolve()
    expect(f.contents.setEmbedder).not.toHaveBeenCalled()
  })

  it.each(['hidden', 'minimized', 'detached', 'destroyed', 'loading'] as const)('rejects a late result after the view becomes %s', async state => {
    const f = fixture()
    f.reconcile()
    if (state === 'hidden') f.view.getVisible.mockReturnValue(false)
    if (state === 'minimized') f.window.isMinimized.mockReturnValue(true)
    if (state === 'detached') f.window.contentView.children = []
    if (state === 'destroyed') f.contents.isDestroyed.mockReturnValue(true)
    if (state === 'loading') f.contents.isLoadingMainFrame.mockReturnValue(true)
    f.resolve('hidden')
    await Promise.resolve()
    expect(f.contents.setEmbedder).not.toHaveBeenCalled()
  })

  it('does not inspect a hidden host', () => {
    const f = fixture()
    f.window.isVisible.mockReturnValue(false)
    f.reconcile()
    expect(f.contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
  })

  it('does not use the internal workaround on an unverified Electron major', () => {
    const f = fixture()
    vi.stubGlobal('process', { ...process, versions: { ...process.versions, electron: '45.0.0' } })
    f.reconcile()
    expect(f.contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
  })
})
