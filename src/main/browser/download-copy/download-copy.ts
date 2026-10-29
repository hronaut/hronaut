import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, realpath, unlink, type FileHandle } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { isWindowsReservedFilename } from '../../../shared/portable-filename.js'
import type { Browser } from '../browser.js'
import type { CompletedDownloadFile } from '../downloads-controller.js'

/** The largest download a copy takes, in bytes. */
export const MAX_DOWNLOAD_COPY_BYTES = 2 * 1024 * 1024 * 1024

/** How much of the file a copy holds in memory at once. */
const COPY_CHUNK_BYTES = 1024 * 1024

/** How many copies may run at once, across all workspaces. */
export const MAX_ACTIVE_DOWNLOAD_COPIES = 2
let activeCopies = 0

/** Owner read and write only, where the platform has POSIX permissions. */
const COPY_FILE_MODE = 0o600

export interface DownloadCopyRequest {
  downloadId: string
  /** An existing folder, as an absolute path. */
  directory: string
  /** A portable file name for the copy, without a folder. */
  filename: string
}

export interface DownloadCopyResult {
  status: 'COPIED'
  downloadId: string
  filename: string
  /** The copy's path, in the folder's resolved location. */
  path: string
  bytes: number
  note: string
}

/**
 * From main-process bookkeeping only: whether this copy created its
 * destination file, and whether it then removed it again after a failure.
 * A copy that created a file and could not remove it leaves the outcome
 * unknown.
 */
export interface DownloadCopyProgress {
  created: boolean
  removed: boolean
}

/** Thrown for a copy that cannot be made; its message never names a path. */
class DownloadCopyProblem extends Error {}

const CHANGED = 'The downloaded file was replaced or changed since it finished downloading, so nothing was copied.'

/**
 * Copies the file of a download the workspace finished into an existing
 * folder under a new portable name, leaving the download and its record as
 * they were. The file must still be the one Hronaut recorded when the
 * download completed (same device, inode, size, and modification and change
 * times) before and after it is read, and the copy never replaces anything:
 * a name that exists, including a symbolic link, is refused. The copy is
 * created readable only by its owner where the platform supports that,
 * flushed to disk, and checked to still be the file under that name, in the
 * same folder, before it is reported. `validate` runs before the copy is
 * created, after each chunk and before the result; its errors pass through
 * unchanged. Once the file exists, any failure removes it only while it is
 * still this copy's file under that name, and `progress.removed` says
 * whether it is gone. Other messages never name a path.
 */
export async function copyDownload(
  browser: Browser,
  workspaceId: string,
  request: DownloadCopyRequest,
  validate?: () => void,
  progress: DownloadCopyProgress = { created: false, removed: false }
): Promise<DownloadCopyResult> {
  const filename = portableCopyFilename(request.filename)
  if (!isAbsolute(request.directory)) throw new DownloadCopyProblem('The destination folder must be an absolute path.')
  validate?.()
  const source = await browser.downloadController.completedWorkspaceDownloadFile(workspaceId, request.downloadId)
  if (source.identity.size > MAX_DOWNLOAD_COPY_BYTES) throw new DownloadCopyProblem('The download is larger than 2 GiB, so it was not copied.')
  if (activeCopies >= MAX_ACTIVE_DOWNLOAD_COPIES) {
    throw new DownloadCopyProblem(`${MAX_ACTIVE_DOWNLOAD_COPIES} downloads are already being copied. Wait for them to finish, then copy again.`)
  }
  activeCopies += 1
  try {
    const { path, bytes } = await copyFile(source, request.directory, filename, validate, progress)
    return {
      status: 'COPIED',
      downloadId: request.downloadId,
      filename,
      path,
      bytes,
      note: 'Copied from the download\'s file, which still matched what Hronaut recorded when the download finished; the download itself is unchanged. The copy is readable only by your account where the system supports that, and stays on this computer.'
    }
  } finally {
    activeCopies -= 1
  }
}

async function copyFile(
  source: CompletedDownloadFile,
  requestedDirectory: string,
  filename: string,
  validate: (() => void) | undefined,
  progress: DownloadCopyProgress
): Promise<{ path: string; bytes: number }> {
  // Errors from the call's own checks pass through unchanged, so a lost lease or a cancellation keeps its meaning.
  let checkFailure: unknown
  const check = (): void => {
    try {
      validate?.()
    } catch (error) {
      checkFailure = error
      throw error
    }
  }
  const directory = await realpath(requestedDirectory).catch(() => undefined)
  if (!directory) throw new DownloadCopyProblem('The destination folder does not exist or cannot be read.')
  const folder = await lstat(directory, { bigint: true }).catch(() => undefined)
  if (!folder?.isDirectory()) throw new DownloadCopyProblem('The destination is not a folder.')
  const target = join(directory, filename)
  // A symbolic link in place of the download is refused rather than followed.
  const input = await open(source.savePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)).catch(() => undefined)
  if (!input) throw new DownloadCopyProblem('The downloaded file is gone or cannot be read, so nothing was copied.')
  let output: FileHandle | undefined
  let created: BigIntStats | undefined
  try {
    if (!sameFile(await input.stat({ bigint: true }), source.identity)) throw new DownloadCopyProblem(CHANGED)
    check()
    // O_EXCL refuses any existing name, a symbolic link included, so nothing is ever overwritten.
    output = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), COPY_FILE_MODE)
      .catch((error: NodeJS.ErrnoException) => {
        throw new DownloadCopyProblem(error.code === 'EEXIST'
          ? 'A file with that name already exists in the destination folder, so nothing was copied or replaced. Choose another name.'
          : 'The destination folder cannot be written to, so nothing was copied.')
      })
    progress.created = true
    created = await output.stat({ bigint: true })
    const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES)
    let bytes = 0
    for (;;) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, bytes)
      if (!bytesRead) break
      if (bytes + bytesRead > source.identity.size) throw new DownloadCopyProblem(CHANGED)
      await writeAll(output, buffer, bytesRead, bytes)
      bytes += bytesRead
      check()
    }
    if (bytes !== source.identity.size || !sameFile(await input.stat({ bigint: true }), source.identity)) throw new DownloadCopyProblem(CHANGED)
    await output.sync()
    // Checked while the copy is still open, so its inode cannot be reused: the name must still be this copy's file,
    // in the same folder, or the result would point at another file.
    const [named, current] = await Promise.all([
      lstat(target, { bigint: true }).catch(() => undefined),
      lstat(directory, { bigint: true }).catch(() => undefined)
    ])
    if (!named || named.dev !== created.dev || named.ino !== created.ino || !current || current.dev !== folder.dev || current.ino !== folder.ino) {
      throw new DownloadCopyProblem('The destination folder or the copy was moved or replaced while copying, so the copy was not kept.')
    }
    check()
    await output.close()
    output = undefined
    return { path: target, bytes }
  } catch (error) {
    if (output) {
      progress.removed = created ? await removeOwnFile(output, target, created) : false
      await output.close().catch(() => undefined)
    }
    if (error === checkFailure && (!progress.created || progress.removed)) throw error
    const message = error === checkFailure || error instanceof DownloadCopyProblem ? (error as Error).message
      : (error as NodeJS.ErrnoException).code === 'ENOSPC' ? 'The destination ran out of space, so nothing was copied.'
        : 'The download could not be copied.'
    if (!progress.created) throw error instanceof DownloadCopyProblem ? error : new DownloadCopyProblem(message)
    throw new DownloadCopyProblem(progress.removed
      ? `${message} The copy it started was removed.`
      : `${message} Hronaut could not confirm that the copy it started is gone, so a file may remain under that name or where it was moved; check the folder before copying again.`)
  } finally {
    await input.close().catch(() => undefined)
  }
}

/** Writes the first `length` bytes of the buffer at the position, however many writes that takes. */
async function writeAll(output: FileHandle, buffer: Buffer, length: number, position: number): Promise<void> {
  let written = 0
  while (written < length) {
    const { bytesWritten } = await output.write(buffer, written, length - written, position + written)
    written += bytesWritten
  }
}

/**
 * Removes the copy's name while it is still this copy's file, and says whether the copy is gone: the still-open
 * file has no names left. A copy that was moved or given another name stays, and counts as remaining. Windows
 * keeps a removed file's name until it is closed, so there the removal itself counts.
 */
async function removeOwnFile(output: FileHandle, target: string, created: BigIntStats): Promise<boolean> {
  const named = await lstat(target, { bigint: true }).catch(() => undefined)
  if (!named || named.dev !== created.dev || named.ino !== created.ino) return false
  if (!await unlink(target).then(() => true, () => false)) return false
  if (process.platform === 'win32') return true
  const after = await output.stat({ bigint: true }).catch(() => undefined)
  return after !== undefined && after.nlink === 0n
}

function sameFile(info: BigIntStats, identity: CompletedDownloadFile['identity']): boolean {
  return info.isFile()
    && String(info.dev) === identity.dev
    && String(info.ino) === identity.ino
    && Number(info.size) === identity.size
    && String(info.mtimeNs) === identity.mtimeNs
    && String(info.ctimeNs) === identity.ctimeNs
}

/**
 * The requested name, when it is one portable file name: no folder, control
 * or reserved characters, no surrounding spaces or trailing dot, not a
 * Windows device name, and at most 255 UTF-8 bytes.
 */
function portableCopyFilename(value: string): string {
  if (
    !value
    || value === '.'
    || value === '..'
    || value !== value.trim()
    // eslint-disable-next-line no-control-regex
    || /[\u0000-\u001f<>:"/\\|?*]/u.test(value)
    || value.endsWith('.')
    || isWindowsReservedFilename(value)
    || Buffer.byteLength(value) > 255
  ) {
    throw new DownloadCopyProblem('filename must be one portable file name, without a folder, surrounding spaces or a trailing dot.')
  }
  return value
}
