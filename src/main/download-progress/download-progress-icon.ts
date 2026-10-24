import { app, type BrowserWindow, type ProgressBarOptions } from 'electron'
import type { BrowserDownloadState } from '../../shared/types.js'

/** How far the downloads under way have come, as Chrome sums them up for its taskbar button and Dock icon. */
export interface DownloadsUnderWay {
  /** How many downloads are under way, paused ones included. */
  count: number
  /** The share of their bytes received so far, from 0 to 1, counting only those whose size is known. */
  progress: number
  /** Whether every download under way has a known size, so that the share tells how far they all have come. */
  known: boolean
}

/** Sums up the downloads under way as Chrome's DownloadStatusUpdater does. */
export function downloadsUnderWay(downloads: readonly BrowserDownloadState[]): DownloadsUnderWay {
  let count = 0
  let known = true
  let received = 0
  let total = 0
  for (const download of downloads) {
    if (download.state !== 'progressing') continue
    count += 1
    if (download.totalBytes <= 0) {
      known = false
      continue
    }
    received += Math.min(download.receivedBytes, download.totalBytes)
    total += download.totalBytes
  }
  return { count, progress: total > 0 ? received / total : 0, known }
}

/**
 * The progress bar a window's icon shows for the downloads under way, as Chrome's: on Windows a bar, moving on its own
 * while a size is unknown, until everything is in; on macOS a bar while every size is known; and on Linux a bar while
 * some but not all of the bytes are in. -1 shows none.
 */
function progressBar({ count, progress, known }: DownloadsUnderWay, platform: NodeJS.Platform): [number, ProgressBarOptions?] {
  if (count === 0) return [-1]
  if (platform === 'win32') {
    if (progress === 1) return [-1]
    return known ? [progress] : [2, { mode: 'indeterminate' }]
  }
  if (platform === 'darwin') return [known ? progress : -1]
  return [progress > 0 && progress < 1 ? progress : -1]
}

/**
 * Shows the downloads under way on Hronaut's taskbar buttons, Dock icon or launcher icon, as Chrome does: on Windows a
 * progress bar on each window's taskbar button; on macOS their number on the Dock icon and, while every size is known,
 * a progress bar; and on Linux desktops that show it, such as Ubuntu's, their number and progress on the launcher icon.
 * Each is changed only when it changes, so the count does not overwrite a badge a website set meanwhile for nothing.
 */
export class DownloadsUnderWayIcons {
  private downloads: readonly BrowserDownloadState[] = []
  /** The count the app icon shows, which is none when Hronaut starts. */
  private badge = 0
  /** The progress bar each window's icon shows, as last set. */
  private readonly progress = new WeakMap<BrowserWindow, string>()

  /**
   * @param windows Hronaut's windows, the main one first: on macOS and Linux one progress bar shows on the app's icon,
   * which the main window sets; on Windows each window's taskbar button shows one.
   */
  constructor(private readonly windows: () => ReadonlyArray<BrowserWindow | null | undefined>, private readonly platform = process.platform) {
    // Windows forgets a taskbar button's progress when the button goes, as while the window hides in the tray.
    app.on('browser-window-created', (_event, window) => {
      window.on('show', () => {
        this.progress.delete(window)
        this.update()
      })
    })
  }

  /** Shows the downloads as they are now. */
  show(downloads: readonly BrowserDownloadState[]): void {
    this.downloads = downloads
    this.update()
  }

  private update(): void {
    const underWay = downloadsUnderWay(this.downloads)
    if ((this.platform === 'darwin' || this.platform === 'linux') && underWay.count !== this.badge) {
      app.setBadgeCount(underWay.count)
      this.badge = underWay.count
    }
    const bar = progressBar(underWay, this.platform)
    const shown = JSON.stringify(bar)
    const windows = this.platform === 'win32' ? this.windows() : this.windows().slice(0, 1)
    for (const window of windows) {
      if (!window || window.isDestroyed() || this.progress.get(window) === shown) continue
      window.setProgressBar(...bar)
      this.progress.set(window, shown)
    }
  }
}
