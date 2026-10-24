import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { BrowserDownloadState } from '../src/shared/types.js'

const app = vi.hoisted(() => ({ setBadgeCount: vi.fn(() => true) }))
vi.mock('electron', () => ({ app }))

const { downloadsUnderWay, showDownloadsUnderWay } = await import('../src/main/download-progress/download-progress-icon.js')

afterEach(() => {
  vi.clearAllMocks()
})

function download(state: BrowserDownloadState['state'], receivedBytes: number, totalBytes: number, paused = false): BrowserDownloadState {
  return { id: `${state}-${receivedBytes}-${totalBytes}`, url: 'https://example.test/file.bin', filename: 'file.bin', state, paused, receivedBytes, totalBytes, startedAt: '2026-10-24T00:00:00.000Z' }
}

function window(destroyed = false) {
  const setProgressBar = vi.fn()
  return { setProgressBar, isDestroyed: () => destroyed } as unknown as BrowserWindow & { setProgressBar: typeof setProgressBar }
}

describe('downloads under way on the taskbar button and Dock icon', () => {
  it('sums up the downloads under way as Chrome does, paused ones included and finished ones left out', () => {
    expect(downloadsUnderWay([
      download('progressing', 25, 100),
      download('progressing', 50, 300, true),
      download('completed', 500, 500),
      download('interrupted', 10, 1000),
      download('cancelled', 1, 10)
    ])).toEqual({ count: 2, progress: 75 / 400, known: true })
    expect(downloadsUnderWay([download('progressing', 25, 100), download('progressing', 400, 0)])).toEqual({ count: 2, progress: 0.25, known: false })
    expect(downloadsUnderWay([])).toEqual({ count: 0, progress: 0, known: true })
  })

  it('shows a progress bar on Windows, moving on its own while a size is unknown, and none once all are done', () => {
    // Hronaut's taskbar button showed nothing while a download was under way.
    const shown = window()
    showDownloadsUnderWay(shown, [download('progressing', 25, 100)], 'win32')
    showDownloadsUnderWay(shown, [download('progressing', 25, 100), download('progressing', 5, 0)], 'win32')
    showDownloadsUnderWay(shown, [download('progressing', 100, 100)], 'win32')
    showDownloadsUnderWay(shown, [download('completed', 100, 100)], 'win32')
    expect(shown.setProgressBar.mock.calls).toEqual([[0.25], [2, { mode: 'indeterminate' }], [-1], [-1]])
    expect(app.setBadgeCount).not.toHaveBeenCalled()
  })

  it('shows on macOS how many are under way and, while every size is known, how far they have come', () => {
    const shown = window()
    showDownloadsUnderWay(shown, [download('progressing', 25, 100), download('progressing', 75, 100)], 'darwin')
    showDownloadsUnderWay(shown, [download('progressing', 25, 100), download('progressing', 5, 0)], 'darwin')
    showDownloadsUnderWay(shown, [], 'darwin')
    expect(shown.setProgressBar.mock.calls).toEqual([[0.5], [-1], [-1]])
    expect(app.setBadgeCount.mock.calls).toEqual([[2], [2], [0]])
  })

  it('shows on Linux how many are under way and how far, as Chrome does on launchers that show it', () => {
    const shown = window()
    showDownloadsUnderWay(shown, [download('progressing', 25, 100), download('progressing', 5, 0)], 'linux')
    showDownloadsUnderWay(shown, [], 'linux')
    expect(shown.setProgressBar.mock.calls).toEqual([[0.25], [-1]])
    expect(app.setBadgeCount.mock.calls).toEqual([[2], [0]])
  })

  it('leaves a closed window alone and still clears the count', () => {
    const closed = window(true)
    showDownloadsUnderWay(closed, [], 'darwin')
    showDownloadsUnderWay(undefined, [download('progressing', 1, 2)], 'linux')
    expect(closed.setProgressBar).not.toHaveBeenCalled()
    expect(app.setBadgeCount.mock.calls).toEqual([[0], [1]])
  })
})
