import type { HronautDownloadsApi } from '../../shared/types.js'
import { DOWNLOADS_IPC } from '../../shared/ipc/downloads.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronautDownloads: the browser's downloads. */
export const downloadsApi: HronautDownloadsApi = {
  list: (checkFiles?: boolean) => invoke(DOWNLOADS_IPC.list, checkFiles === true),
  pause: (downloadId: string) => invoke(DOWNLOADS_IPC.pause, downloadId),
  resume: (downloadId: string) => invoke(DOWNLOADS_IPC.resume, downloadId),
  cancel: (downloadId: string) => invoke(DOWNLOADS_IPC.cancel, downloadId),
  retry: (downloadId: string) => invoke(DOWNLOADS_IPC.retry, downloadId),
  removeFinished: (downloadId: string) => invoke(DOWNLOADS_IPC.removeFinished, downloadId),
  clearFinished: () => invoke(DOWNLOADS_IPC.clearFinished),
  showInFolder: (downloadId: string) => invoke(DOWNLOADS_IPC.showInFolder, downloadId),
  startDrag: (downloadId: string) => invoke(DOWNLOADS_IPC.startDrag, downloadId),
  onChanged: (listener) => subscribe(DOWNLOADS_IPC.changed, (downloads) => listener(downloads))
}
