import type { BigIntStats } from 'node:fs'
import { lstat, mkdir, open, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { MessageKey } from '../../shared/i18n.js'
import { LocalizedError } from '../localized-error.js'

/** The sentence for each file system error that commonly stops an export from being saved. */
const SAVE_FAILURE_MESSAGES: Record<string, MessageKey> = {
  EACCES: 'appErrors.export.saveDenied',
  EPERM: 'appErrors.export.saveDenied',
  ENOSPC: 'appErrors.export.saveDiskFull',
  EDQUOT: 'appErrors.export.saveDiskFull',
  EROFS: 'appErrors.export.saveReadOnly'
}

/**
 * A common file system failure as a person reads it: a sentence that ends with its code and leaves out the path. Its
 * message stays Node's, for MCP results and logs, and so do the code, errno, syscall and path Node gave. Any other
 * failure, including the caller's own validation, is returned as it is.
 */
function localizedSaveFailure(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof LocalizedError) return error
  const failure = error as NodeJS.ErrnoException
  if (typeof failure.code !== 'string' || !Object.hasOwn(SAVE_FAILURE_MESSAGES, failure.code)) return error
  const localized = new LocalizedError(SAVE_FAILURE_MESSAGES[failure.code]!, { code: failure.code }, { message: error.message, cause: error })
  // Only the details Node gave, so a missing one stays absent rather than undefined.
  for (const detail of ['code', 'errno', 'syscall', 'path'] as const) {
    if (failure[detail] !== undefined) Object.assign(localized, { [detail]: failure[detail] })
  }
  return localized
}

/** Reserve a new export exclusively and remove its partial contents on failure. */
export async function writeUniqueDownloadFile(
  directory: string,
  filename: string,
  data: Buffer,
  validate: () => void = () => undefined
): Promise<string> {
  try {
    return await reserveAndWrite(directory, filename, data, validate)
  } catch (error) {
    throw localizedSaveFailure(error)
  }
}

async function reserveAndWrite(directory: string, filename: string, data: Buffer, validate: () => void): Promise<string> {
  await mkdir(directory, { recursive: true })
  const extension = extname(filename)
  const stem = filename.slice(0, filename.length - extension.length)
  for (let index = 0; index <= 9_999; index += 1) {
    const candidateName = index === 0 ? filename : `${stem} (${index})${extension}`
    const candidate = join(directory, candidateName)
    validate()
    let handle
    try {
      handle = await open(candidate, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
    let ownedFile: BigIntStats | undefined
    try {
      ownedFile = await handle.stat({ bigint: true })
      validate()
      await handle.writeFile(data)
      validate()
      await handle.close()
      validate()
      return candidate
    } catch (error) {
      await handle.close().catch(() => undefined)
      // The user may have moved the partial export and reused its name while
      // the write was pending. Never clean up an observed replacement file.
      const currentFile = await lstat(candidate, { bigint: true }).catch(() => undefined)
      if (ownedFile && currentFile && ownedFile.dev === currentFile.dev && ownedFile.ino === currentFile.ino) {
        await rm(candidate, { force: true }).catch(() => undefined)
      }
      throw error
    }
  }
  // The file name comes from the page title, so a person reads the sentence without it.
  throw new LocalizedError('appErrors.export.nameUnavailable', undefined, { message: `Could not allocate a unique download path for ${filename}` })
}
