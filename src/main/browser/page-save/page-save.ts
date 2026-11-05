import { stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { dialog, type SaveDialogOptions, type SaveDialogReturnValue, type WebContents } from 'electron'
import { LocalizedError } from '../../localized-error.js'
import { pageScript } from '../../../shared/page-script.js'
import { portableExportFilename, portableFilename } from '../../../shared/portable-filename.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { rememberSaveDialogFolder, saveDialogFolder } from '../downloads/save-dialog-folder.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { SHELL_INTEGRATED_EXTENSION } from '../saved-link-names.js'
import { isAddressTitle } from '../tab-events/untitled-page-title.js'
import { isHronautHomeUrl } from '../url.js'
import { documentContentTypeInPage } from './page-save.page.js'

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

/** The document types saved as a web page with its files, as Chrome's SavePackage::CanSaveAsComplete has them. */
const WEB_PAGE_TYPES: ReadonlySet<string> = new Set(['text/html', 'application/xhtml+xml'])

/** The extension a saved file of each type gets when its name has none; any other text gets `.txt`. */
const FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/json': 'json', 'application/pdf': 'pdf', 'application/xml': 'xml', 'text/xml': 'xml', 'text/plain': 'txt',
  'text/css': 'css', 'text/csv': 'csv', 'text/markdown': 'md', 'text/javascript': 'js', 'application/javascript': 'js',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'video/mp4': 'mp4', 'video/webm': 'webm',
  'video/ogg': 'ogv', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'weba', 'audio/flac': 'flac'
}

/**
 * The name the save dialog suggests for a document that is not a web page, such as an image, a PDF, text or JSON, as
 * Chromium names a download of it: the last part of its address's path, keeping its extension, or with the extension
 * of its type when it has none, or else its site's name with that extension. An extension Windows runs or follows when
 * it shows the file becomes `.download`, as for Save Link As. The query and fragment, which can hold a sign-in token,
 * never go in it.
 */
export function savedFileFilename(url: string, contentType: string): string {
  let name = ''
  let site = ''
  try {
    const address = new URL(url)
    if (address.protocol === 'http:' || address.protocol === 'https:') {
      const last = address.pathname.slice(address.pathname.lastIndexOf('/') + 1)
      try {
        name = decodeURIComponent(last)
      } catch {
        name = last
      }
      site = address.hostname
    }
  } catch {
    name = ''
  }
  name = name.trim()
  const dot = name.lastIndexOf('.')
  const own = dot > 0 ? name.slice(dot) : ''
  if (SHELL_INTEGRATED_EXTENSION.test(own)) return portableFilename(name.slice(0, dot), '.download', 'download')
  if (/^\.[\p{L}\p{N}_-]{1,16}$/u.test(own)) return portableFilename(name.slice(0, dot), own, 'download')
  const extension = FILE_EXTENSIONS[contentType] ?? (contentType.startsWith('text/') ? 'txt' : undefined)
  return portableFilename(name || site, extension ? `.${extension}` : '', 'download')
}

// How long Save Page As waits for the page to say what its document is, and longer while it loads, as an image or a
// text file answers only once it has all of it. A page busy with its own work is saved as a web page, as one always was.
const CONTENT_TYPE_WAIT_MS = 1_000
const LOADING_CONTENT_TYPE_WAIT_MS = 10_000

/**
 * The type of the document the page shows, as Chromium has it (`document.contentType`), or undefined when the page
 * does not answer in time. It runs in a world of its own, so the page cannot change what it reads.
 */
async function documentContentType(webContents: WebContents): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wait = webContents.isLoadingMainFrame() ? LOADING_CONTENT_TYPE_WAIT_MS : CONTENT_TYPE_WAIT_MS
  const waited = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), wait) })
  const read = webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLDS.pageSave, [{ code: pageScript(documentContentTypeInPage) }])
    .catch(() => undefined)
  const type: unknown = await Promise.race([read, waited])
  clearTimeout(timer)
  return typeof type === 'string' ? type.toLowerCase() : undefined
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
 * Chrome's Save Page As: the system's save dialog, opening where the last save dialog saved (see saveDialogFolder) with
 * the page's title as its name, then the page as it is now, with the images and other files it shows in a folder beside
 * it (Webpage, Complete) or, for a name ending in `.mhtml`, as one file (Webpage, Single File). A document that is not a
 * web page, such as an image, a PDF, text or JSON, is saved as Chrome saves it, as the file the website sends: Chrome
 * downloads an image, a PDF or JSON again (WebContentsImpl::OnSavePage), and so does Hronaut for each, from its
 * address, under the name that address ends in (see savedFileFilename), to the file chosen, which Downloads lists and
 * which says itself whether it saved. Nothing opens behind
 * trusted chrome, on a tab whose human input lock holds the person's input back, for Hronaut Home, a sleeping page or
 * one whose renderer is gone, nor while the page's save dialog is already open. A page that went away, or started or finished loading
 * another page, while the dialog was open is not saved, so the file never holds another page than the one chosen; a
 * page changing its own address, as a web app does, still is. Says whether it saved the page, or started the download
 * of its file; a save that fails rejects.
 */
export async function savePageAs(browser: Browser, tab: BrowserTab): Promise<boolean> {
  const webContents = tab.webContents
  if (webContents.isDestroyed() || webContents.isCrashed() || tab.sleeping || isHronautHomeUrl(tab.url)) return false
  if (browser.browserContentOccluded || browser.isHumanInteractionLocked(tab)) return false
  const saving = (browser.pageSaving ??= new Set())
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
    const url = webContents.getURL()
    const contentType = await documentContentType(webContents)
    // Nothing opens if the person moved on while the page answered: to a Hronaut dialog, another page or none.
    if (webContents.isDestroyed() || webContents.isCrashed() || tab.sleeping) return false
    if (browser.browserContentOccluded || browser.isHumanInteractionLocked(tab)) return false
    if (leftPage) throw new LocalizedError('appErrors.page.saveChanged')
    const webPage = contentType === undefined || WEB_PAGE_TYPES.has(contentType)
    const choice = await showSaveDialog(browser, {
      title: browser.text('native.dialog.savePageTitle'),
      ...webPage ? {
        defaultPath: join(saveDialogFolder(browser), savedPageFilename(webContents.getTitle(), webContents.getURL())),
        filters: [
          { name: browser.text('native.dialog.webpageComplete'), extensions: ['html', 'htm'] },
          { name: browser.text('native.dialog.webpageSingleFile'), extensions: ['mhtml'] }
        ]
      } : { defaultPath: join(saveDialogFolder(browser), savedFileFilename(url, contentType)) },
      properties: ['showOverwriteConfirmation', 'createDirectory']
    })
    if (choice.canceled || !choice.filePath) return false
    rememberSaveDialogFolder(browser, choice.filePath)
    if (webContents.isDestroyed() || webContents.isCrashed() || leftPage) throw new LocalizedError('appErrors.page.saveChanged')
    if (!webPage) {
      // Saved as a page, even the website's own file gets an `.html` name in place of the one chosen, so it is downloaded.
      browser.downloadController.expectSavedFile(webContents.id, url, choice.filePath)
      webContents.downloadURL(url)
      return true
    }
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
export function saveShownPage(browser: Browser): Promise<boolean> {
  const tab = browser.activeTabId ? browser.tabs.get(browser.activeTabId) : undefined
  return tab ? savePageAs(browser, tab) : Promise.resolve(false)
}

/** Asks where to save, over the browser's window; a window that is gone saves nothing. */
function showSaveDialog(browser: Browser, options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
  return browser.window.isDestroyed()
    ? Promise.resolve({ canceled: true, filePath: '' })
    : dialog.showSaveDialog(browser.window, options)
}
