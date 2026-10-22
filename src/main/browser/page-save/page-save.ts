import { stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { WebContents } from 'electron'
import { LocalizedError } from '../../localized-error.js'
import { portableExportFilename } from '../../../shared/portable-filename.js'
import { isAddressTitle } from '../tab-events/untitled-page-title.js'
import { isHronautHomeUrl } from '../url.js'
import type { PageSaveAccess, PageSaveTab } from './page-save-access.js'

/**
 * The name the save dialog suggests, as Chrome's Save Page As does: the page's title, or its site's name when it has
 * none, as a portable file name ending in `.html`. Chromium names an untitled page by its address, whose fragment can
 * hold a sign-in token, so a title that is an address on the page's site gives the site's name too.
 */
export function savedPageFilename(title: string, url: string): string {
  let name = title.trim() === url || isAddressTitle(title, url) ? '' : title
  if (!name.trim()) {
    try {
      name = new URL(url).hostname
    } catch {
      name = ''
    }
  }
  return portableExportFilename(undefined, name, 'html')
}

/** How the page is written for the name chosen: a single MHTML file, or the page with a folder of its files. */
export function savedPageType(filePath: string): 'MHTML' | 'HTMLComplete' {
  return /^\.mht(?:ml)?$/iu.test(extname(filePath)) ? 'MHTML' : 'HTMLComplete'
}

/** When the file at the path was last changed, or undefined when there is none. */
function modifiedAt(filePath: string): Promise<number | undefined> {
  return stat(filePath).then((file) => file.isFile() ? file.mtimeMs : undefined, () => undefined)
}

/** Saves the page, failing when its renderer goes away meanwhile, for which Electron may never answer. */
function savePageFile(webContents: WebContents, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const pageGone = (): void => {
      detach()
      reject(new LocalizedError('appErrors.page.saveFailed'))
    }
    const detach = (): void => {
      webContents.removeListener('render-process-gone', pageGone)
      webContents.removeListener('destroyed', pageGone)
    }
    webContents.once('render-process-gone', pageGone)
    webContents.once('destroyed', pageGone)
    webContents.savePage(filePath, savedPageType(filePath)).then(
      () => {
        detach()
        resolve()
      },
      (error: unknown) => {
        detach()
        console.error('[browser] Could not save the page:', error)
        reject(new LocalizedError('appErrors.page.saveFailed'))
      }
    )
  })
}

/**
 * Chrome's Save Page As: the system's save dialog, opening in the download folder with the page's title as its name,
 * then the page as it is now, with the images and other files it shows in a folder beside it (Webpage, Complete) or,
 * for a name ending in `.mhtml`, as one file (Webpage, Single File). Nothing opens behind trusted chrome, on a tab
 * whose human input lock holds the person's input back, for Hronaut Home, a sleeping page or one whose renderer is
 * gone, nor while the page's save dialog is already open. A page that went away, or started or finished loading
 * another page, while the dialog was open is not saved, so the file never holds another page than the one chosen; a
 * page changing its own address, as a web app does, still is. Says whether it saved the page; a save that fails
 * rejects.
 */
export async function savePageAs<Tab extends PageSaveTab>(access: PageSaveAccess<Tab>, tab: Tab): Promise<boolean> {
  const webContents = tab.webContents
  if (webContents.isDestroyed() || webContents.isCrashed() || tab.sleeping || isHronautHomeUrl(tab.url)) return false
  if (access.browserContentOccluded() || access.isHumanInteractionLocked(tab)) return false
  const saving = access.savingWebContents()
  const id = webContents.id
  if (saving.has(id)) return false
  saving.add(id)
  let leftPage = false
  const onNavigation = (_event: unknown, _url: string, isSameDocument: boolean, isMainFrame: boolean): void => {
    if (isMainFrame && !isSameDocument) leftPage = true
  }
  const onNavigated = (): void => { leftPage = true }
  const onGone = (): void => { leftPage = true }
  webContents.on('did-start-navigation', onNavigation)
  webContents.on('did-navigate', onNavigated)
  webContents.on('render-process-gone', onGone)
  try {
    const choice = await access.showSaveDialog({
      title: access.text('native.dialog.savePageTitle'),
      defaultPath: join(access.downloadDirectory(), savedPageFilename(webContents.getTitle(), webContents.getURL())),
      filters: [
        { name: access.text('native.dialog.webpageComplete'), extensions: ['html', 'htm'] },
        { name: access.text('native.dialog.webpageSingleFile'), extensions: ['mhtml'] }
      ],
      properties: ['showOverwriteConfirmation', 'createDirectory']
    })
    if (choice.canceled || !choice.filePath) return false
    if (webContents.isDestroyed() || webContents.isCrashed() || leftPage) throw new LocalizedError('appErrors.page.saveChanged')
    const before = await modifiedAt(choice.filePath)
    await savePageFile(webContents, choice.filePath)
    // Electron can report a save it could not write as done, as one into a folder that is gone, so the file shows
    // whether it was saved: there, and changed when the person chose to replace one.
    const after = await modifiedAt(choice.filePath)
    if (after === undefined || after === before) throw new LocalizedError('appErrors.page.saveFailed')
    return true
  } finally {
    saving.delete(id)
    if (!webContents.isDestroyed()) {
      webContents.removeListener('did-start-navigation', onNavigation)
      webContents.removeListener('did-navigate', onNavigated)
      webContents.removeListener('render-process-gone', onGone)
    }
  }
}

/** Save Page As for the page the window shows, for the menu and its key; see savePageAs. */
export function saveShownPage<Tab extends PageSaveTab>(access: PageSaveAccess<Tab>): Promise<boolean> {
  const tab = access.shownTab()
  return tab ? savePageAs(access, tab) : Promise.resolve(false)
}
