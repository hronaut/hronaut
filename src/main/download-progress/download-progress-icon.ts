import { app, type BrowserWindow } from 'electron'
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
 * Shows the downloads under way on Hronaut's taskbar button or Dock icon, as Chrome does: on Windows a progress bar,
 * moving on its own while a size is unknown; on macOS their number on the icon and, while every size is known, a
 * progress bar; and on Linux desktops that show it, such as Ubuntu's, their number and progress on the launcher icon.
 */
export function showDownloadsUnderWay(window: BrowserWindow | null | undefined, downloads: readonly BrowserDownloadState[], platform = process.platform): void {
  const { count, progress, known } = downloadsUnderWay(downloads)
  if (platform === 'darwin' || platform === 'linux') app.setBadgeCount(count)
  if (!window || window.isDestroyed()) return
  if (platform === 'win32') {
    if (count === 0 || progress === 1) window.setProgressBar(-1)
    else if (!known) window.setProgressBar(2, { mode: 'indeterminate' })
    else window.setProgressBar(progress)
    return
  }
  if (platform === 'darwin') {
    window.setProgressBar(count > 0 && known ? progress : -1)
    return
  }
  window.setProgressBar(count > 0 ? progress : -1)
}
