import type { BrowserDownloadState } from '../types.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** The browser's downloads, for the Downloads panel and the toolbar's download button. */
export const DOWNLOADS_IPC = {
  /** Shell → main: every download; with checkFiles, also checks finished files are still there. */
  list: 'downloads:list' as InvokeChannel<[checkFiles: boolean], BrowserDownloadState[]>,
  /** Shell → main: pauses a download, answering with every download after. */
  pause: 'downloads:pause' as InvokeChannel<[downloadId: string], BrowserDownloadState[]>,
  /** Shell → main: resumes a paused download, answering with every download after. */
  resume: 'downloads:resume' as InvokeChannel<[downloadId: string], BrowserDownloadState[]>,
  /** Shell → main: cancels a download, answering with every download after. */
  cancel: 'downloads:cancel' as InvokeChannel<[downloadId: string], BrowserDownloadState[]>,
  /** Shell → main: downloads a cancelled or failed download's address again, answering with every download after. */
  retry: 'downloads:retry' as InvokeChannel<[downloadId: string], BrowserDownloadState[]>,
  /** Shell → main: removes a finished download from the list, answering with every download after. */
  removeFinished: 'downloads:remove-finished' as InvokeChannel<[downloadId: string], BrowserDownloadState[]>,
  /** Shell → main: removes every finished download from the list, answering with every download after. */
  clearFinished: 'downloads:clear-finished' as InvokeChannel<[], BrowserDownloadState[]>,
  /** Shell → main: shows a download's file in its folder. */
  showInFolder: 'downloads:show-in-folder' as InvokeChannel<[downloadId: string], void>,
  /** Shell → main: drags a completed download's file out of the window the shell is in. */
  startDrag: 'downloads:start-drag' as InvokeChannel<[downloadId: string], void>,
  /** Main → shells: the downloads changed. */
  changed: 'browser:downloads-changed' as EventChannel<[downloads: BrowserDownloadState[]]>
} as const
