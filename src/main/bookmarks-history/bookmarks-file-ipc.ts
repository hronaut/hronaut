import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type { BookmarkImportResult, BrowserBookmark } from '../../shared/types.js'
import { writeTextFileAtomically } from '../atomic-file.js'
import type { BookmarkStore } from './bookmark-store.js'
import { bookmarksHtml, decodeBookmarksFile, parseBookmarksHtml } from './bookmarks-html.js'
import { LocalizedError } from '../localized-error.js'

/** Far larger than the bookmarks file of anyone with thousands of bookmarks. */
export const MAX_BOOKMARKS_FILE_BYTES = 16 * 1024 * 1024

interface BookmarksFileIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  bookmarks(): Pick<BookmarkStore, 'list' | 'collectionSnapshot' | 'importBookmarks'>
  /** The file the person picks in the system's Save dialog over the asking window, suggested by name; none when they cancel. */
  pickExportFile(sender: WebContents, suggestedName: string): Promise<string | undefined>
  /** The HTML file the person picks in the system's Open dialog over the asking window; none when they cancel. */
  pickImportFile(sender: WebContents): Promise<string | undefined>
  publishBookmarks(): BrowserBookmark[]
  now?(): Date
}

/** Named as Chrome names an exported bookmarks file, by the day: bookmarks_10_24_26.html. */
function exportFileName(day: Date): string {
  const part = (value: number) => String(value).padStart(2, '0')
  return `bookmarks_${part(day.getMonth() + 1)}_${part(day.getDate())}_${part(day.getFullYear() % 100)}.html`
}

/**
 * The picked file's bytes. Only a regular file is read, and no more of it than a bookmarks file can be, even if it
 * grows while it is read; opening does not wait, so a named pipe cannot hold the import up.
 */
async function readBookmarksFile(path: string): Promise<Buffer> {
  let file
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch {
    throw new LocalizedError('appErrors.bookmarks.importUnreadable')
  }
  try {
    const stats = await file.stat()
    if (!stats.isFile()) throw new LocalizedError('appErrors.bookmarks.importUnreadable')
    if (stats.size > MAX_BOOKMARKS_FILE_BYTES) throw new LocalizedError('appErrors.bookmarks.importTooLarge')
    // One byte more than the limit tells a file that grew past it.
    const buffer = Buffer.alloc(MAX_BOOKMARKS_FILE_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > MAX_BOOKMARKS_FILE_BYTES) throw new LocalizedError('appErrors.bookmarks.importTooLarge')
    return buffer.subarray(0, length)
  } catch (error) {
    if (error instanceof LocalizedError) throw error
    throw new LocalizedError('appErrors.bookmarks.importUnreadable')
  } finally {
    await file.close()
  }
}

/**
 * Exports bookmarks to an HTML bookmarks file and imports them from one, as Chrome's bookmark manager does, so they
 * move between Hronaut and Chrome, Firefox, Safari or Edge. The files are the ones the person picks in the system's
 * own dialogs; the window only asks for the dialog and hears what happened.
 */
export function registerBookmarksFileIpc(ipcMain: Pick<IpcMain, 'handle'>, host: BookmarksFileIpcHost): void {
  ipcMain.handle('bookmarks:export-file', async (event): Promise<number | null> => {
    host.assertTrustedSender(event)
    const path = await host.pickExportFile(event.sender, exportFileName(host.now?.() ?? new Date()))
    if (!path) return null
    const store = host.bookmarks()
    const bookmarks = store.list()
    try {
      await writeTextFileAtomically(path, bookmarksHtml(bookmarks, store.collectionSnapshot().collections))
    } catch {
      throw new LocalizedError('appErrors.bookmarks.exportFailed')
    }
    return bookmarks.length
  })
  ipcMain.handle('bookmarks:import-file', async (event): Promise<BookmarkImportResult | null> => {
    host.assertTrustedSender(event)
    const path = await host.pickImportFile(event.sender)
    if (!path) return null
    const { bookmarks: found, notRead } = parseBookmarksHtml(decodeBookmarksFile(await readBookmarksFile(path)))
    if (!found.length) throw new LocalizedError('appErrors.bookmarks.importEmpty')
    let result: BookmarkImportResult
    try {
      result = await host.bookmarks().importBookmarks(found)
    } catch (error) {
      if (error instanceof LocalizedError) throw error
      throw new LocalizedError('appErrors.bookmarks.storageUnavailable')
    }
    if (result.added) host.publishBookmarks()
    // Links past the most a file is read for are left out as those past the bookmark limit are.
    return { ...result, overLimit: result.overLimit + notRead }
  })
}
