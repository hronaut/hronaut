import { getEventListeners } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoRenderPlan } from '../src/shared/video.js'

const electron = vi.hoisted(() => ({ BrowserWindow: vi.fn() }))
vi.mock('electron', () => electron)
import { renderBrowserVideo } from '../src/main/browser/video-export.js'

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
