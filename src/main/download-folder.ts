import { mkdir } from 'node:fs/promises'
import type { MessageKey } from '../shared/i18n.js'
import { LocalizedError } from './localized-error.js'

/** The sentence for each file system error that commonly stops Hronaut from creating the download folder. */
const FOLDER_FAILURE_MESSAGES: Record<string, MessageKey> = {
  EACCES: 'appErrors.settings.downloadFolderDenied',
  EPERM: 'appErrors.settings.downloadFolderDenied',
  ENOSPC: 'appErrors.settings.downloadFolderDiskFull',
  EDQUOT: 'appErrors.settings.downloadFolderDiskFull',
  EROFS: 'appErrors.settings.downloadFolderReadOnly',
  EEXIST: 'appErrors.settings.downloadFolderBlocked',
  ENOTDIR: 'appErrors.settings.downloadFolderBlocked',
  // Windows reports a drive or network share that is not there as a missing path.
  ENOENT: 'appErrors.settings.downloadFolderMissingDrive'
}

/**
 * Creates the download folder Settings chose or opens. A failure reads, on Hronaut's own pages, as a sentence in the
 * interface language that names the cause and includes its code but not the path. The error itself keeps Node's
 * message and the code, errno, syscall and path Node gave, for code in the main process. An error without a code is
 * thrown as it is.
 */
export async function createDownloadFolder(directory: string): Promise<void> {
  try {
    await mkdir(directory, { recursive: true })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const failure = error as NodeJS.ErrnoException
    if (typeof failure.code !== 'string') throw error
    const key = Object.hasOwn(FOLDER_FAILURE_MESSAGES, failure.code)
      ? FOLDER_FAILURE_MESSAGES[failure.code]!
      : 'appErrors.settings.downloadFolderUnavailable'
    const localized = new LocalizedError(key, { code: failure.code }, { message: error.message, cause: error })
    // Only the details Node gave, so a missing one stays absent rather than undefined.
    for (const detail of ['code', 'errno', 'syscall', 'path'] as const) {
      if (failure[detail] !== undefined) Object.assign(localized, { [detail]: failure[detail] })
    }
    throw localized
  }
}
