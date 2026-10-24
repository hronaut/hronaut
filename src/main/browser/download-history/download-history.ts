import { lstat, readFile, rm } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { isActiveDownload } from '../../../shared/download-state.js'
import type { BrowserDownloadState } from '../../../shared/types.js'
import { writeTextFileAtomically } from '../../atomic-file.js'

/** As many downloads as the Downloads panel keeps. */
const MAX_SAVED_DOWNLOADS = 200
/** As a record keeps its address. */
const MAX_DOWNLOAD_URL_CHARS = 4_096
/** A saved download history larger than all its downloads can be is not read. */
const MAX_DOWNLOAD_HISTORY_FILE_BYTES = 16 * 1024 * 1024
const DOWNLOAD_HISTORY_VERSION = 1
const DOWNLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** A download as the file keeps it for the next start, with the workspace whose page started it. */
export interface SavedDownload {
  id: string
  url: string
  filename: string
  savePath?: string
  state: 'completed' | 'cancelled' | 'interrupted'
  failureReason?: 'destination-unavailable'
  receivedBytes: number
  totalBytes: number
  startedAt: string
  completedAt?: string
  workspaceId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

/** A saved time, no later than now, so a clock set back since cannot keep a download first in the list for good. */
function savedTime(value: string, now: number): string {
  return new Date(Math.min(Date.parse(value), now)).toISOString()
}

/**
 * The downloads a restart keeps, newest first, as Chrome keeps its download history. One still under way is kept as
 * cancelled, as quitting cancels it, and without its progress, so a save while it runs writes nothing new.
 */
export function savedDownloads(
  downloads: readonly BrowserDownloadState[],
  workspaceOf: (downloadId: string) => string | undefined
): SavedDownload[] {
  return downloads.slice(0, MAX_SAVED_DOWNLOADS).map((download) => {
    const workspaceId = workspaceOf(download.id)
    const common = {
      id: download.id,
      url: download.url,
      filename: download.filename,
      ...(download.savePath ? { savePath: download.savePath } : {}),
      startedAt: download.startedAt,
      ...(workspaceId ? { workspaceId } : {})
    }
    if (isActiveDownload(download)) return { ...common, state: 'cancelled', receivedBytes: 0, totalBytes: 0 }
    return {
      ...common,
      state: download.state === 'progressing' ? 'cancelled' : download.state,
      ...(download.failureReason ? { failureReason: download.failureReason } : {}),
      receivedBytes: download.receivedBytes,
      totalBytes: download.totalBytes,
      ...(download.completedAt ? { completedAt: download.completedAt } : {})
    }
  })
}

/** A download as the file holds it, or undefined when it is not one. */
function parsedDownload(value: unknown, now: number): SavedDownload | undefined {
  if (!isRecord(value)) return undefined
  const { id, url, filename, savePath, state, failureReason, receivedBytes, totalBytes, startedAt, completedAt, workspaceId } = value
  if (typeof id !== 'string' || !DOWNLOAD_ID.test(id) || typeof url !== 'string' || url.length > MAX_DOWNLOAD_URL_CHARS
    || typeof filename !== 'string' || !filename || basename(filename) !== filename
    || (savePath !== undefined && (typeof savePath !== 'string' || !isAbsolute(savePath) || basename(savePath) !== filename))
    || (state !== 'completed' && state !== 'cancelled' && state !== 'interrupted')
    || (failureReason !== undefined && failureReason !== 'destination-unavailable')
    || !isByteCount(receivedBytes) || !isByteCount(totalBytes) || !isTime(startedAt)
    || (completedAt !== undefined && !isTime(completedAt))
    || (workspaceId !== undefined && typeof workspaceId !== 'string')) return undefined
  // A completed download always had its file.
  if (state === 'completed' && !savePath) return undefined
  return {
    id,
    url,
    filename,
    ...(savePath ? { savePath } : {}),
    state,
    ...(failureReason ? { failureReason } : {}),
    receivedBytes,
    totalBytes,
    startedAt: savedTime(startedAt, now),
    // An interrupted download without an end would read as still under way.
    ...(completedAt || state === 'interrupted' ? { completedAt: savedTime(completedAt ?? startedAt, now) } : {}),
    ...(workspaceId ? { workspaceId } : {})
  }
}

/**
 * The download history, kept for the next start in the profile, as Chrome keeps it. A file that is missing or cannot
 * be read only loses it, and the next save replaces it.
 */
export class DownloadHistoryStore {
  private saveQueue: Promise<void> = Promise.resolve()
  private written: string | undefined
  /** What the last save could not write, so a save of the same downloads every second does not try again. */
  private failed: string | undefined

  constructor(private readonly path: string) {}

  /** The downloads the file kept, newest first. */
  async load(): Promise<SavedDownload[]> {
    let contents: string
    try {
      // lstat refuses a link, which the profile never holds here.
      const entry = await lstat(this.path)
      if (!entry.isFile() || entry.size > MAX_DOWNLOAD_HISTORY_FILE_BYTES) throw new Error('Not a saved download history')
      contents = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[downloads] The saved download history could not be read; Downloads starts empty.')
      return []
    }
    try {
      const data = JSON.parse(contents) as unknown
      if (!isRecord(data) || data.version !== DOWNLOAD_HISTORY_VERSION || !Array.isArray(data.downloads)) throw new Error('Not a saved download history')
      const ids = new Set<string>()
      const now = Date.now()
      const saved = data.downloads.slice(0, MAX_SAVED_DOWNLOADS).flatMap((value) => {
        const download = parsedDownload(value, now)
        if (!download || ids.has(download.id)) return []
        ids.add(download.id)
        return [download]
      })
      this.written = contents
      return saved
    } catch {
      console.warn('[downloads] The saved download history could not be read; Downloads starts empty.')
      return []
    }
  }

  /**
   * Saves the downloads, taken when the save's turn comes, unless the file holds them already, or the same downloads
   * could not be written last time and `retryFailedWrite` is off. Nothing is saved when none are given, as once the
   * browser closes. A write that fails removes the file, so a download removed since does not come back at the next
   * start, as Recently closed does.
   */
  save(downloads: () => readonly SavedDownload[] | undefined, retryFailedWrite = true): Promise<void> {
    const operation = this.saveQueue.then(async () => {
      const current = downloads()
      if (!current) return
      const contents = `${JSON.stringify({ version: DOWNLOAD_HISTORY_VERSION, downloads: current })}\n`
      if (contents === this.written || (!retryFailedWrite && contents === this.failed)) return
      try {
        await writeTextFileAtomically(this.path, contents, 0o600)
      } catch (error) {
        this.written = undefined
        this.failed = contents
        await rm(this.path, { force: true }).catch(() => undefined)
        throw error
      }
      this.written = contents
      this.failed = undefined
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}
