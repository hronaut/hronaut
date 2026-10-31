import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import type { Browser } from '../browser.js'

/** The kept folder each browser last looked at, and whether it could be saved into then. */
const checked = new WeakMap<Browser, { folder: string; usable: boolean }>()

/**
 * The folder a save dialog starts in, as in Chrome: the one the last save dialog saved into, a download's or Save Page
 * As's alike, while it is a folder Hronaut can write to, such as one on a drive still attached; otherwise the download
 * folder. The folder is looked at in the background, never while the person waits: one on a network share that went
 * away can take a minute to answer. So the answer is the one from the last look, and each dialog looks again for the next.
 */
export function saveDialogFolder(browser: Browser): string {
  const folder = browser.options.getSaveDialogDirectory?.()
  if (!folder || !isAbsolute(folder)) return browser.options.downloadDirectory
  const last = checked.get(browser)
  void checkSaveDialogFolder(browser)
  return last?.folder === folder && last.usable ? folder : browser.options.downloadDirectory
}

/** Looks at the kept folder in the background, as at startup, so the next save dialog knows whether it can start there. */
export async function checkSaveDialogFolder(browser: Browser): Promise<void> {
  const folder = browser.options.getSaveDialogDirectory?.()
  if (!folder || !isAbsolute(folder)) return
  await usableFolder(folder).then((usable) => {
    // A folder kept since was looked at by then, or will be.
    if (browser.options.getSaveDialogDirectory?.() === folder) checked.set(browser, { folder, usable })
  })
}

/** Keeps the folder of the file a save dialog saved for the next save dialog to start in. */
export function rememberSaveDialogFolder(browser: Browser, filePath: string): void {
  if (!isAbsolute(filePath)) return
  const folder = dirname(filePath)
  // The person just chose it, so it is there.
  checked.set(browser, { folder, usable: true })
  if (folder !== browser.options.getSaveDialogDirectory?.()) browser.options.setSaveDialogDirectory?.(folder)
}

async function usableFolder(folder: string): Promise<boolean> {
  try {
    if (!(await stat(folder)).isDirectory()) return false
    // As Chrome does for a download it asks about, a folder Hronaut cannot write to is not offered.
    await access(folder, constants.W_OK)
    return true
  } catch {
    return false
  }
}
