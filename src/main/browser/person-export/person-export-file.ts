import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app, BrowserWindow, dialog, type WebContents } from 'electron'
import type { MessageKey } from '../../../shared/i18n.js'
import type { Browser } from '../browser.js'
import { localizedSaveFailure, writeUniqueDownloadFile, type ExportFileWriter } from '../unique-download-file.js'

/**
 * The file system errors that say the download folder cannot take a new file: no permission, a read-only drive, a
 * path that is a file or no longer a folder, or a drive that is gone. Others, such as a full disk, fail as they are.
 */
const UNWRITABLE_FOLDER_CODES = new Set(['EACCES', 'EPERM', 'EROFS', 'EEXIST', 'ENOTDIR', 'ENOENT'])

/** The sentence for each common failure to save into the folder the person chose, which is not the download folder. */
const CHOSEN_FOLDER_FAILURES: Record<string, MessageKey> = {
  EACCES: 'appErrors.export.chosenSaveDenied',
  EPERM: 'appErrors.export.chosenSaveDenied',
  ENOSPC: 'appErrors.export.saveDiskFull',
  EDQUOT: 'appErrors.export.saveDiskFull',
  EROFS: 'appErrors.export.chosenReadOnly'
}

/** Chrome retries a rename that Windows refuses for a moment, as while a virus scanner reads the new file. */
const RENAME_RETRY_DELAYS_MS = [200, 400, 800]
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

/** The Documents folder, where Chrome starts the save dialog of a download its download folder cannot take. */
function documentsFolder(): string {
  try {
    return app.getPath('documents')
  } catch {
    // Electron has no Documents folder to name on some Linux desktops.
    return homedir()
  }
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as NodeJS.ErrnoException).code : undefined
}

async function replaceWith(partial: string, path: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await rename(partial, path)
    } catch (error) {
      const wait = RENAME_RETRY_DELAYS_MS[attempt]
      if (wait === undefined || !TRANSIENT_RENAME_CODES.has(String(errorCode(error)))) throw error
      await delay(wait)
    }
  }
}

/**
 * Writes the file the person named in the save dialog, which already asked before replacing one: whole or not at all,
 * through a file beside it that takes its place, as Chrome saves a download.
 */
async function writeChosenFile(path: string, data: Buffer, validate: () => void): Promise<void> {
  const partial = join(dirname(path), `.hronaut-${randomUUID()}.tmp`)
  try {
    await writeFile(partial, data, { flag: 'wx' })
    validate()
    await replaceWith(partial, path)
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined)
    throw localizedSaveFailure(error, CHOSEN_FOLDER_FAILURES)
  }
}

/**
 * Where an export the person asked for in Hronaut's own controls goes, such as Save as PDF, a recording's video or a
 * HAR file: a new file in the download folder, as a download is saved. As in Chrome, a download folder Hronaut cannot
 * write to, such as one on a drive that became read-only, asks where to save the file instead, over the window that
 * asked and starting in the Documents folder; cancelling that dialog saves nothing. Agents' exports never ask, and
 * fail as before.
 */
export function personExportFile(browser: Browser, asking?: WebContents): ExportFileWriter {
  return async (filename, data, validate) => {
    try {
      return await writeUniqueDownloadFile(browser.options.downloadDirectory, filename, data, validate)
    } catch (error) {
      if (!UNWRITABLE_FOLDER_CODES.has(String(errorCode(error)))) throw error
    }
    // A panel moved to its own window asks over that window, where the person is looking.
    const window = (asking && !asking.isDestroyed() ? BrowserWindow.fromWebContents(asking) : null) ?? browser.window
    if (window.isDestroyed()) return undefined
    const choice = await dialog.showSaveDialog(window, {
      defaultPath: join(documentsFolder(), filename),
      properties: ['showOverwriteConfirmation', 'createDirectory']
    })
    if (choice.canceled || !choice.filePath) return undefined
    validate()
    await writeChosenFile(choice.filePath, data, validate)
    return choice.filePath
  }
}
