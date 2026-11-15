import { getEventListeners } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoRenderPlan } from '../src/shared/video.js'

const electron = vi.hoisted(() => ({ BrowserWindow: vi.fn() }))
vi.mock('electron', () => electron)
import { exportDeadlineMs, renderBrowserVideo } from '../src/main/browser/video-export.js'

const plan: VideoRenderPlan = {
  width: 320,
  height: 240,
  durationMs: 100,
  annotations: [],
  clips: [{ startMs: 0, endMs: 100 }]
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('video export renderer cleanup', () => {
  it.each(['window handler', 'navigation listener', 'page load'])('releases the hidden window, timer, and abort listener after failed %s setup', async (stage) => {
    const failure = new Error(`${stage} failed`)
    let destroyed = false
    const window = {
      isDestroyed: () => destroyed,
      destroy: vi.fn(() => { destroyed = true }),
      webContents: {
        setWindowOpenHandler: vi.fn(() => {
          if (stage === 'window handler') throw failure
        }),
        on: vi.fn(() => {
          if (stage === 'navigation listener') throw failure
        })
      },
      loadURL: vi.fn(async () => { throw failure })
    }
    electron.BrowserWindow.mockImplementation(function () { return window })
    const controller = new AbortController()

    await expect(renderBrowserVideo(plan, [], controller.signal, () => undefined)).rejects.toBe(failure)

    expect(window.destroy).toHaveBeenCalledOnce()
    expect(destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(getEventListeners(controller.signal, 'abort')).toEqual([])
    if (stage !== 'page load') expect(window.loadURL).not.toHaveBeenCalled()
  })
})

it.each(['page load', 'encoder call'] as const)('settles cancellation even when Electron never settles its %s promise', async stage => {
  let destroyed = false
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const pending = () => { entered(); return new Promise<never>(() => undefined) }
  const window = {
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => { destroyed = true }),
    webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn(), executeJavaScript: vi.fn(pending) },
    loadURL: stage === 'page load' ? vi.fn(pending) : vi.fn(async () => undefined)
  }
  electron.BrowserWindow.mockImplementation(function () { return window })
  const controller = new AbortController()
  const exportPromise = renderBrowserVideo(plan, [], controller.signal, () => undefined)
  await started
  const rejected = expect(exportPromise).rejects.toThrow('cancelled')
  controller.abort()
  await rejected
  expect(window.destroy).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  expect(getEventListeners(controller.signal, 'abort')).toEqual([])
})

it('settles the export timeout even when Electron never settles the page load', async () => {
  let destroyed = false
  const window = {
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => { destroyed = true }),
    webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn() },
    loadURL: vi.fn(() => new Promise<never>(() => undefined))
  }
  electron.BrowserWindow.mockImplementation(function () { return window })
  const controller = new AbortController()
  const rejected = expect(renderBrowserVideo(plan, [], controller.signal, () => undefined)).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(5 * 60_000)
  await rejected
  expect(window.destroy).toHaveBeenCalledOnce()
  expect(getEventListeners(controller.signal, 'abort')).toEqual([])
})

it('ends at once with its own error when the export renderer goes away', async () => {
  let destroyed = false
  const listeners = new Map<string, () => void>()
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const window = {
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => { destroyed = true }),
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => { listeners.set(event, listener) }),
      executeJavaScript: vi.fn(() => { entered(); return new Promise<never>(() => undefined) })
    },
    loadURL: vi.fn(async () => undefined)
  }
  electron.BrowserWindow.mockImplementation(function () { return window })
  const controller = new AbortController()
  const exportPromise = renderBrowserVideo(plan, [], controller.signal, () => undefined)
  await started
  const rejected = expect(exportPromise).rejects.toThrow('Video export stopped unexpectedly')
  listeners.get('render-process-gone')!()
  await rejected
  expect(window.destroy).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  expect(getEventListeners(controller.signal, 'abort')).toEqual([])
})

it('gives a long video more time than five minutes, and every export one shared session', async () => {
  expect(exportDeadlineMs(30)).toBe(5 * 60_000)
  let destroyed = false
  const window = {
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => { destroyed = true }),
    webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn() },
    loadURL: vi.fn(() => new Promise<never>(() => undefined))
  }
  electron.BrowserWindow.mockImplementation(function () { return window })
  const twoMinutes: VideoRenderPlan = { ...plan, durationMs: 120_000, clips: [{ startMs: 0, endMs: 120_000 }] }
  let settled = false
  const exportPromise = renderBrowserVideo(twoMinutes, [], new AbortController().signal, () => undefined)
  const rejected = expect(exportPromise.finally(() => { settled = true })).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(5 * 60_000)
  expect(settled).toBe(false)
  await vi.advanceTimersByTimeAsync(exportDeadlineMs(3600) - 5 * 60_000)
  await rejected
  expect(electron.BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
    webPreferences: expect.objectContaining({ partition: 'video-export' })
  }))
})
