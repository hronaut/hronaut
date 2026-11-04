import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { app, dialog } from 'electron'
import { downloadFolderWritable } from '../../download-folder.js'
import type { Browser } from '../browser.js'
import { localizedSaveFailure, writeUniqueDownloadFile, type ExportFileWriter } from '../unique-download-file.js'

/** The Documents folder, where Chrome starts the save dialog of a download its download folder cannot take. */
function documentsFolder(): string {
  try {
    return app.getPath('documents')
  } catch {
    // Electron has no Documents folder to name on some Linux desktops.
    return homedir()
  }
}

/**
 * Writes the file the person named in the save dialog, which already asked before replacing one: whole or not at all,
 * through a file beside it that takes its place.
 */
async function writeChosenFile(path: string, data: Buffer, validate: () => void): Promise<void> {
  const partial = join(dirname(path), `.hronaut-${randomUUID()}.tmp`)
  try {
    await writeFile(partial, data, { flag: 'wx' })
    validate()
    await rename(partial, path)
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined)
    throw localizedSaveFailure(error)
  }
}

/**
 * Where an export the person asked for in Hronaut's own controls goes, such as Save as PDF, a recording's video or a
 * HAR file: a new file in the download folder, as a download is saved. As in Chrome, a download folder Hronaut cannot
 * write to, such as one on a drive that became read-only, asks where to save the file instead, starting in the
 * Documents folder; cancelling that dialog saves nothing. Agents' exports never ask, and fail as before.
 */
export function personExportFile(browser: Browser): ExportFileWriter {
  return async (filename, data, validate) => {
    const folder = browser.options.downloadDirectory
    if (downloadFolderWritable(folder)) return writeUniqueDownloadFile(folder, filename, data, validate)
    if (browser.window.isDestroyed()) return undefined
    const choice = await dialog.showSaveDialog(browser.window, {
      defaultPath: join(documentsFolder(), filename),
      properties: ['showOverwriteConfirmation', 'createDirectory']
    })
    if (choice.canceled || !choice.filePath) return undefined
    validate()
    await writeChosenFile(choice.filePath, data, validate)
    return choice.filePath
  }
}
