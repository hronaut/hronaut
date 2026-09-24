import type { BrowserDownloadState } from './types.js'

/** An interrupted download remains live until Electron reports it as done. */
export function isActiveDownload(download: BrowserDownloadState): boolean {
  return download.state === 'progressing'
    || (download.state === 'interrupted' && !download.completedAt)
}
