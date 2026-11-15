import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { BrowserDownloadState } from '../src/shared/types.js'

const app = await vi.hoisted(async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  return Object.assign(new Emitter(), { setBadgeCount: vi.fn(() => true) })
})
vi.mock('electron', () => ({ app }))

const { downloadsUnderWay, DownloadsUnderWayIcons } = await import('../src/main/download-progress/download-progress-icon.js')

afterEach(() => {
  vi.clearAllMocks()
  app.removeAllListeners()
})

function download(state: BrowserDownloadState['state'], receivedBytes: number, totalBytes: number, paused = false): BrowserDownloadState {
  return { id: `${state}-${receivedBytes}-${totalBytes}`, url: 'https://example.test/file.bin', filename: 'file.bin', state, paused, receivedBytes, totalBytes, startedAt: '2026-10-24T00:00:00.000Z' }
}

/** A window as Electron makes it: it tells the app it was created, and tells of each time it shows. */
function window(destroyed = false) {
  const created = Object.assign(new EventEmitter(), { setProgressBar: vi.fn(), isDestroyed: () => destroyed })
  app.emit('browser-window-created', {}, created)
  return created as unknown as BrowserWindow & EventEmitter & { setProgressBar: ReturnType<typeof vi.fn> }
}

describe('downloads under way on the taskbar buttons and Dock icon', () => {
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

  it('shows a progress bar on each Windows taskbar button, moving on its own while a size is unknown, and none once all are in', () => {
    // Hronaut's taskbar button showed nothing while a download was under way.
    const main = window()
    const panel = window()
    const icons = new DownloadsUnderWayIcons(() => [main, panel], 'win32')
    icons.show([download('progressing', 25, 100)])
    icons.show([download('progressing', 25, 100), download('progressing', 5, 0)])
    icons.show([download('progressing', 100, 100)])
    icons.show([download('completed', 100, 100)])
    for (const shown of [main, panel]) expect(shown.setProgressBar.mock.calls).toEqual([[0.25], [2, { mode: 'indeterminate' }], [-1]])
    expect(app.setBadgeCount).not.toHaveBeenCalled()
  })

  it('shows on macOS how many are under way and, while every size is known, how far they have come, on the app\'s one icon', () => {
    const main = window()
    const panel = window()
    const icons = new DownloadsUnderWayIcons(() => [main, panel], 'darwin')
    icons.show([download('progressing', 25, 100), download('progressing', 75, 100)])
    icons.show([download('progressing', 25, 100), download('progressing', 5, 0)])
    icons.show([])
    expect(main.setProgressBar.mock.calls).toEqual([[0.5], [-1]])
    expect(panel.setProgressBar).not.toHaveBeenCalled()
    expect(app.setBadgeCount.mock.calls).toEqual([[2], [0]])
  })

  it('shows on Linux how many are under way and, while some but not all bytes are in, how far, as Chrome does', () => {
    const main = window()
    const icons = new DownloadsUnderWayIcons(() => [main], 'linux')
    icons.show([download('progressing', 0, 100)])
    icons.show([download('progressing', 25, 100), download('progressing', 5, 0)])
    icons.show([download('progressing', 100, 100)])
    icons.show([])
    expect(main.setProgressBar.mock.calls).toEqual([[-1], [0.25], [-1]])
    expect(app.setBadgeCount.mock.calls).toEqual([[1], [2], [1], [0]])
  })

  it('changes nothing when nothing changed, so a badge a website set stays until the count changes', () => {
    const main = window()
    const icons = new DownloadsUnderWayIcons(() => [main], 'darwin')
    icons.show([download('completed', 1, 1)])
    icons.show([])
    icons.show([download('progressing', 1, 2)])
    icons.show([download('progressing', 1, 2)])
    expect(app.setBadgeCount.mock.calls).toEqual([[1]])
    expect(main.setProgressBar.mock.calls).toEqual([[-1], [0.5]])
  })

  it('shows the progress again when a window shows again, as Windows forgets it while the window hides in the tray', () => {
    // The icons are made before any window, as Hronaut makes them as it starts.
    const windows: BrowserWindow[] = []
    const icons = new DownloadsUnderWayIcons(() => windows, 'win32')
    const main = window()
    windows.push(main)
    icons.show([download('progressing', 1, 4, true)])
    main.emit('show')
    expect(main.setProgressBar.mock.calls).toEqual([[0.25], [0.25]])
  })

  it('leaves a closed window alone', () => {
    const closed = window(true)
    const icons = new DownloadsUnderWayIcons(() => [closed, undefined], 'win32')
    icons.show([download('progressing', 1, 2)])
    expect(closed.setProgressBar).not.toHaveBeenCalled()
  })
})
