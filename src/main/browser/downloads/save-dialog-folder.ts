import { statSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import type { Browser } from '../browser.js'

/**
 * The folder a save dialog starts in, as in Chrome: the one the last save dialog saved into, a download's or Save Page
 * As's alike, while it is still a folder, such as on a drive still attached; otherwise the download folder.
 */
export function saveDialogFolder(browser: Browser): string {
  const folder = browser.options.getSaveDialogDirectory?.()
  if (!folder || !isAbsolute(folder)) return browser.options.downloadDirectory
  try {
    return statSync(folder).isDirectory() ? folder : browser.options.downloadDirectory
  } catch {
    return browser.options.downloadDirectory
  }
}

/** Keeps the folder of the file a save dialog saved for the next save dialog to start in. */
export function rememberSaveDialogFolder(browser: Browser, filePath: string): void {
  if (!isAbsolute(filePath)) return
  const folder = dirname(filePath)
  if (folder !== browser.options.getSaveDialogDirectory?.()) browser.options.setSaveDialogDirectory?.(folder)
}
