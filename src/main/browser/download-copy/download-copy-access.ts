import type { CompletedDownloadFile } from '../downloads-controller.js'

/**
 * What copying a finished download needs from the tab manager, which keeps
 * the download records and their workspaces private.
 */
export interface DownloadCopyAccess {
  /** The file of a download the workspace finished, as recorded when it completed; it throws for anything else. */
  completedDownloadFile(workspaceId: string, downloadId: string): Promise<CompletedDownloadFile>
}
