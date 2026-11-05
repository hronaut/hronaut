import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SaveDialogOptions, SaveDialogReturnValue, WebContents } from 'electron'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { checkSaveDialogFolder } from '../src/main/browser/downloads/save-dialog-folder.js'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'
import { documentContentTypeInPage } from '../src/main/browser/page-save/page-save.page.js'
import { pageScript } from '../src/shared/page-script.js'
import { savedFileFilename, savedPageFilename, savedPageType, savePageAs, saveShownPage } from '../src/main/browser/page-save/page-save.js'
import type { LocalizedError } from '../src/main/localized-error.js'

// The save dialog opens over the fake browser's window, which records the options it was asked with.
vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: (window: { showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue> }, options: SaveDialogOptions) =>
      window.showSaveDialog(options)
  }
}))

type SaveTab = Pick<BrowserTab, 'id' | 'url' | 'sleeping' | 'webContents'>

// Hronaut could not save a page: Ctrl/Cmd+S did nothing, and neither the menu nor the page's context menu offered it.

let directory = ''
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'hronaut-save-page-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

function harness(options: {
  browser?: { occluded?: boolean; locked?: boolean }
  tab?: Partial<SaveTab>
  choose?: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>
  savePage?: (path: string, type: string) => Promise<void>
  /** What the page answers when asked the type of its document. */
  contentType?: () => Promise<unknown>
  /** The folder the last save dialog saved into. */
  saveDialogDirectory?: string
} = {}) {
  const events = new EventEmitter()
  const savePage = vi.fn(options.savePage ?? (async (path: string) => { await writeFile(path, '<html></html>') }))
  const readType = vi.fn(options.contentType ?? (async () => 'text/html'))
  const webContents = Object.assign(events, {
    id: 7,
    isDestroyed: () => false,
    isCrashed: () => false,
    isLoadingMainFrame: () => false,
    getURL: () => 'https://docs.example/guide',
    getTitle: () => 'Guide: Getting started',
    savePage,
    executeJavaScriptInIsolatedWorld: readType,
    downloadURL: vi.fn()
  }) as unknown as WebContents
  const tab: SaveTab = { id: 'tab', url: 'https://docs.example/guide', sleeping: false, webContents, ...options.tab }
  const saving = new Set<number>()
  let kept = options.saveDialogDirectory ?? null
  const showSaveDialog = vi.fn(options.choose ?? (async () => ({ canceled: false, filePath: join(directory, 'guide.html') })))
  const browser = {
    activeTabId: tab.id,
    tabs: new Map([[tab.id, tab]]),
    browserContentOccluded: options.browser?.occluded === true,
    isHumanInteractionLocked: () => options.browser?.locked === true,
    options: {
      downloadDirectory: directory,
      getSaveDialogDirectory: () => kept,
      setSaveDialogDirectory: (folder: string) => { kept = folder }
    },
    window: { isDestroyed: () => false, showSaveDialog },
    text: (key: string) => `text:${key}`,
    pageSaving: saving,
    downloadController: { expectSavedFile: vi.fn() }
  } as unknown as Browser
  return { browser, tab: tab as BrowserTab, events, savePage, showSaveDialog, saving, readType, kept: () => kept }
}

describe('the name Save Page As suggests', () => {
  it('is the page title as a portable file name ending in .html', () => {
    expect(savedPageFilename('Guide: Getting started / Part 1?', 'https://docs.example/guide')).toBe('Guide- Getting started - Part 1-.html')
    expect(savedPageFilename('.NET documentation', 'https://learn.example/')).toBe('NET documentation.html')
    expect(savedPageFilename('CON', 'https://docs.example/')).toBe('page-CON.html')
  })

  it('is the site\'s name for a page with no title, as for one whose title is its address', () => {
    expect(savedPageFilename('', 'https://docs.example/guide')).toBe('docs.example.html')
    expect(savedPageFilename('https://docs.example/guide', 'https://docs.example/guide')).toBe('docs.example.html')
    expect(savedPageFilename('', 'about:blank')).toBe('page.html')
    // Chromium names an untitled page by its address as it shows it, whose fragment can hold a sign-in token.
    const callback = 'https://app.example/callback#access_token=secret'
    expect(savedPageFilename('app.example/callback#access_token=secret', callback)).toBe('app.example.html')
    expect(savedPageFilename('127.0.0.1:3000/dashboard', 'http://127.0.0.1:3000/dashboard')).toBe('127.0.0.1.html')
    expect(savedPageFilename('\u202Aapp.example/مرحبا#token\u202C', 'https://app.example/x')).toBe('app.example.html')
  })

  it('is the name a file\'s address ends in for a document that is not a web page, with its type\'s extension, as a download\'s', () => {
    expect(savedFileFilename('https://cdn.example/photos/sunset.png?size=large#token=secret', 'image/png')).toBe('sunset.png')
    expect(savedFileFilename('https://cdn.example/photos/Sunset.JPEG', 'image/jpeg')).toBe('Sunset.JPEG')
    expect(savedFileFilename('https://api.example/v1/status', 'application/json')).toBe('status.json')
    // A name keeps its own extension, as Chromium's download keeps it, and any other text is named as text.
    expect(savedFileFilename('https://api.example/v1/status.php', 'application/json')).toBe('status.php')
    expect(savedFileFilename('https://raw.example/project/main.py', 'text/plain')).toBe('main.py')
    expect(savedFileFilename('https://raw.example/project/README', 'text/x-readme')).toBe('README.txt')
    // An extension Windows runs or follows when it shows the file is not suggested, as for Save Link As.
    expect(savedFileFilename('https://share.example/files/share.url', 'text/x-shortcut')).toBe('share.download')
    expect(savedFileFilename('https://share.example/files/report.LNK', 'image/png')).toBe('report.download')
    expect(savedFileFilename('https://docs.example/files/Annual%20report%202025.pdf', 'application/pdf')).toBe('Annual report 2025.pdf')
    expect(savedFileFilename('https://notes.example/', 'text/plain')).toBe('notes.example.txt')
    expect(savedFileFilename('http://127.0.0.1:8080/', 'application/json')).toBe('127.0.0.1.json')
    // A name a file system refuses, and an address that names no file, as a data: one.
    expect(savedFileFilename('https://files.example/a%2Fb%3Ac.txt', 'text/plain')).toBe('a-b-c.txt')
    expect(savedFileFilename('https://files.example/con.png', 'image/png')).toBe('download-con.png')
    expect(savedFileFilename('https://files.example/%E0%A4%A', 'text/plain')).toBe('%E0%A4%A.txt')
    expect(savedFileFilename('data:text/plain,secret', 'text/plain')).toBe('download.txt')
    expect(savedFileFilename('https://media.example/stream', 'application/octet-stream')).toBe('stream')
  })

  it('saves a name ending in .mhtml or .mht as one file, and any other with a folder of its files', () => {
    expect(savedPageType('/saved/guide.mhtml')).toBe('MHTML')
    expect(savedPageType('/saved/guide.MHT')).toBe('MHTML')
    expect(savedPageType('/saved/guide.html')).toBe('HTMLComplete')
    expect(savedPageType('/saved/guide.htm')).toBe('HTMLComplete')
    expect(savedPageType('/saved/guide')).toBe('HTMLComplete')
  })
})

describe('Save Page As', () => {
  it('asks where to save in the download folder under the page title, then saves the page with its files', async () => {
    const { browser, tab, savePage, showSaveDialog, saving } = harness()
    await expect(savePageAs(browser, tab)).resolves.toBe(true)
    expect(showSaveDialog).toHaveBeenCalledExactlyOnceWith({
      title: 'text:native.dialog.savePageTitle',
      defaultPath: join(directory, 'Guide- Getting started.html'),
      filters: [
        { name: 'text:native.dialog.webpageComplete', extensions: ['html', 'htm'] },
        { name: 'text:native.dialog.webpageSingleFile', extensions: ['mhtml'] }
      ],
      properties: ['showOverwriteConfirmation', 'createDirectory']
    })
    expect(savePage).toHaveBeenCalledExactlyOnceWith(join(directory, 'guide.html'), 'HTMLComplete')
    expect(saving.size).toBe(0)
  })

  it('asks what the page shows in a world of its own, and saves a web page whatever case its type is in', async () => {
    const { browser, tab, savePage, readType } = harness({ contentType: async () => 'APPLICATION/XHTML+XML' })
    await expect(savePageAs(browser, tab)).resolves.toBe(true)
    expect(readType).toHaveBeenCalledExactlyOnceWith(ISOLATED_WORLDS.pageSave, [{ code: pageScript(documentContentTypeInPage) }])
    expect(savePage).toHaveBeenCalledExactlyOnceWith(join(directory, 'guide.html'), 'HTMLComplete')
  })

  it('downloads an image, a PDF, text or JSON to the file chosen, as Chrome saves a document it cannot save as a page', async () => {
    for (const [url, type, name] of [
      ['https://cdn.example/photos/sunset.png', 'image/png', 'sunset.png'],
      ['https://docs.example/report.pdf', 'application/pdf', 'report.pdf'],
      ['https://notes.example/today', 'text/plain', 'today.txt'],
      ['https://api.example/status', 'application/json', 'status.json']
    ] as const) {
      // Whatever name the person gives it, even one ending in .mhtml, it is the file itself.
      const chosen = join(directory, `${name}.mhtml`)
      const { browser, tab, savePage, showSaveDialog } = harness({ contentType: async () => type, choose: async () => ({ canceled: false, filePath: chosen }) })
      ;(tab.webContents as unknown as { getURL: () => string }).getURL = () => url
      await expect(savePageAs(browser, tab)).resolves.toBe(true)
      expect(showSaveDialog).toHaveBeenCalledExactlyOnceWith({
        title: 'text:native.dialog.savePageTitle',
        defaultPath: join(directory, name),
        properties: ['showOverwriteConfirmation', 'createDirectory']
      })
      expect(browser.downloadController.expectSavedFile).toHaveBeenCalledExactlyOnceWith(7, url, chosen)
      expect(tab.webContents.downloadURL).toHaveBeenCalledExactlyOnceWith(url)
      expect(savePage).not.toHaveBeenCalled()
    }
  })

  it('opens no dialog when the person moved on while the page said what it shows', async () => {
    let answer: (type: string) => void = () => undefined
    const asking = () => harness({ contentType: () => new Promise((resolve) => { answer = resolve }) })
    const left = asking()
    const leaving = savePageAs(left.browser, left.tab)
    left.events.emit('did-start-navigation', {}, 'https://docs.example/other', false, true)
    answer('text/html')
    expect(((await leaving.catch((error: unknown) => error)) as LocalizedError).key).toBe('appErrors.page.saveChanged')
    expect(left.showSaveDialog).not.toHaveBeenCalled()

    for (const moveOn of [
      (browser: Browser) => { (browser as { browserContentOccluded: boolean }).browserContentOccluded = true },
      (_browser: Browser, tab: BrowserTab) => { (tab as { sleeping: boolean }).sleeping = true },
      (_browser: Browser, tab: BrowserTab) => { (tab.webContents as unknown as { isDestroyed: () => boolean }).isDestroyed = () => true }
    ]) {
      const moved = asking()
      const saving = savePageAs(moved.browser, moved.tab)
      moveOn(moved.browser, moved.tab)
      answer('image/png')
      await expect(saving).resolves.toBe(false)
      expect(moved.showSaveDialog).not.toHaveBeenCalled()
      expect(moved.saving.size).toBe(0)
    }
  })

  it('saves a page as a web page when it cannot say what it shows in time', async () => {
    const failed = harness({ contentType: async () => { throw new Error('Script failed to execute') } })
    await expect(savePageAs(failed.browser, failed.tab)).resolves.toBe(true)
    expect(failed.savePage).toHaveBeenCalledExactlyOnceWith(join(directory, 'guide.html'), 'HTMLComplete')

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const busy = harness({ contentType: () => new Promise(() => undefined) })
      const saving = savePageAs(busy.browser, busy.tab)
      await vi.advanceTimersByTimeAsync(999)
      expect(busy.showSaveDialog).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await expect(saving).resolves.toBe(true)
      expect(busy.showSaveDialog.mock.calls[0]?.[0]?.filters).toHaveLength(2)
      expect(busy.savePage).toHaveBeenCalledExactlyOnceWith(join(directory, 'guide.html'), 'HTMLComplete')
      expect(vi.getTimerCount()).toBe(0)

      // A page still loading, as an image or a text file answers once it has all of it, gets ten seconds.
      const loading = harness({ contentType: () => new Promise(() => undefined) })
      ;(loading.tab.webContents as unknown as { isLoadingMainFrame: () => boolean }).isLoadingMainFrame = () => true
      const loadingSave = savePageAs(loading.browser, loading.tab)
      await vi.advanceTimersByTimeAsync(9_999)
      expect(loading.showSaveDialog).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await expect(loadingSave).resolves.toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks in the folder the last save dialog saved into, and keeps the folder chosen for the next, as in Chrome', async () => {
    const last = await mkdtemp(join(tmpdir(), 'hronaut-save-page-last-'))
    try {
      const chosen = join(last, 'pages', 'guide.html')
      await mkdir(join(last, 'pages'))
      const { browser, tab, showSaveDialog, kept } = harness({ saveDialogDirectory: last, choose: async () => ({ canceled: false, filePath: chosen }) })
      // As at startup, the kept folder is looked at before the first dialog.
      await checkSaveDialogFolder(browser)
      await expect(savePageAs(browser, tab)).resolves.toBe(true)
      expect(showSaveDialog.mock.calls[0]?.[0]?.defaultPath).toBe(join(last, 'Guide- Getting started.html'))
      expect(kept()).toBe(join(last, 'pages'))
    } finally {
      await rm(last, { recursive: true, force: true })
    }
  })

  it('keeps the folder the save dialog starts in when the person cancels it', async () => {
    const { browser, tab, kept } = harness({ choose: async () => ({ canceled: true, filePath: '' }) })
    await expect(savePageAs(browser, tab)).resolves.toBe(false)
    expect(kept()).toBeNull()
  })

  it('saves one MHTML file for a name ending in .mhtml', async () => {
    const { browser, tab, savePage } = harness({ choose: async () => ({ canceled: false, filePath: join(directory, 'guide.mhtml') }) })
    await expect(savePageAs(browser, tab)).resolves.toBe(true)
    expect(savePage).toHaveBeenCalledExactlyOnceWith(join(directory, 'guide.mhtml'), 'MHTML')
  })

  it('saves nothing when the person cancels', async () => {
    const { browser, tab, savePage } = harness({ choose: async () => ({ canceled: true, filePath: '' }) })
    await expect(savePageAs(browser, tab)).resolves.toBe(false)
    expect(savePage).not.toHaveBeenCalled()
  })

  it('opens nothing behind trusted chrome, on a locked tab, for Home, a sleeping page or one whose renderer is gone', async () => {
    const refused = [
      harness({ browser: { occluded: true } }),
      harness({ browser: { locked: true } }),
      harness({ tab: { url: 'hronaut://home/' } }),
      harness({ tab: { sleeping: true } })
    ]
    const crashed = harness()
    ;(crashed.tab.webContents as unknown as { isCrashed: () => boolean }).isCrashed = () => true
    const destroyed = harness()
    ;(destroyed.tab.webContents as unknown as { isDestroyed: () => boolean }).isDestroyed = () => true
    for (const { browser, tab, showSaveDialog } of [...refused, crashed, destroyed]) {
      await expect(savePageAs(browser, tab)).resolves.toBe(false)
      expect(showSaveDialog).not.toHaveBeenCalled()
    }
  })

  it('opens one save dialog at a time for a page', async () => {
    let choose: (value: SaveDialogReturnValue) => void = () => undefined
    const { browser, tab, showSaveDialog } = harness({ choose: () => new Promise((resolve) => { choose = resolve }) })
    const first = savePageAs(browser, tab)
    // Neither while the page says what it shows nor while the dialog is open.
    await expect(savePageAs(browser, tab)).resolves.toBe(false)
    await vi.waitFor(() => expect(showSaveDialog).toHaveBeenCalledOnce())
    await expect(savePageAs(browser, tab)).resolves.toBe(false)
    expect(showSaveDialog).toHaveBeenCalledOnce()
    choose({ canceled: true, filePath: '' })
    await expect(first).resolves.toBe(false)
    const again = savePageAs(browser, tab)
    await vi.waitFor(() => expect(showSaveDialog).toHaveBeenCalledTimes(2))
    choose({ canceled: true, filePath: '' })
    await expect(again).resolves.toBe(false)
  })

  it('does not save another page loaded while the dialog was open, but saves one that changed its own address', async () => {
    let choose: (value: SaveDialogReturnValue) => void = () => undefined
    const chosen = { canceled: false, filePath: join(directory, 'guide.html') }
    const left = harness({ choose: () => new Promise((resolve) => { choose = resolve }) })
    const leaving = savePageAs(left.browser, left.tab)
    await vi.waitFor(() => expect(left.showSaveDialog).toHaveBeenCalledOnce())
    left.events.emit('did-start-navigation', {}, 'https://docs.example/other', false, true)
    choose(chosen)
    const failure = await leaving.catch((error: unknown) => error)
    expect((failure as LocalizedError).key).toBe('appErrors.page.saveChanged')
    expect(left.savePage).not.toHaveBeenCalled()
    expect(left.events.listenerCount('did-start-navigation')).toBe(0)

    // Nor one that finished loading another page, or crashed and reloaded, while the dialog was open.
    for (const event of ['did-navigate', 'render-process-gone']) {
      const loaded = harness({ choose: () => new Promise((resolve) => { choose = resolve }) })
      const loading = savePageAs(loaded.browser, loaded.tab)
      await vi.waitFor(() => expect(loaded.showSaveDialog).toHaveBeenCalledOnce())
      loaded.events.emit(event)
      choose(chosen)
      expect(((await loading.catch((error: unknown) => error)) as LocalizedError).key).toBe('appErrors.page.saveChanged')
      expect(loaded.savePage).not.toHaveBeenCalled()
    }

    // Nor download the file of a document that is not a web page.
    const image = harness({ contentType: async () => 'image/png', choose: () => new Promise((resolve) => { choose = resolve }) })
    const imageSave = savePageAs(image.browser, image.tab)
    await vi.waitFor(() => expect(image.showSaveDialog).toHaveBeenCalledOnce())
    image.events.emit('did-navigate')
    choose(chosen)
    expect(((await imageSave.catch((error: unknown) => error)) as LocalizedError).key).toBe('appErrors.page.saveChanged')
    expect(image.browser.downloadController.expectSavedFile).not.toHaveBeenCalled()
    expect(image.tab.webContents.downloadURL).not.toHaveBeenCalled()

    const stayed = harness({ choose: () => new Promise((resolve) => { choose = resolve }) })
    const staying = savePageAs(stayed.browser, stayed.tab)
    stayed.events.emit('did-start-navigation', {}, 'https://docs.example/guide#setup', true, true)
    stayed.events.emit('did-start-navigation', {}, 'https://ads.example/frame', false, false)
    await vi.waitFor(() => expect(stayed.showSaveDialog).toHaveBeenCalledOnce())
    choose(chosen)
    await expect(staying).resolves.toBe(true)
  })

  it('reports a save that failed, also one Electron reported as done without writing the file', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rejected = harness({ savePage: async () => { throw new Error('net::ERR_FAILED') } })
    const failure = await savePageAs(rejected.browser, rejected.tab).catch((error: unknown) => error)
    expect((failure as LocalizedError).key).toBe('appErrors.page.saveFailed')
    expect(rejected.saving.size).toBe(0)
    expect(logged).toHaveBeenCalledOnce()
    logged.mockRestore()

    const unwritten = harness({ savePage: async () => undefined })
    const missing = await savePageAs(unwritten.browser, unwritten.tab).catch((error: unknown) => error)
    expect((missing as LocalizedError).key).toBe('appErrors.page.saveFailed')

    // A file the person chose to replace and that stayed as it was is not a saved page either.
    const existing = join(directory, 'existing.html')
    await writeFile(existing, 'older page')
    const unchanged = harness({ savePage: async () => undefined, choose: async () => ({ canceled: false, filePath: existing }) })
    const kept = await savePageAs(unchanged.browser, unchanged.tab).catch((error: unknown) => error)
    expect((kept as LocalizedError).key).toBe('appErrors.page.saveFailed')
    const replaced = harness({
      savePage: async (path) => { await utimes(path, new Date(), new Date(Date.now() + 5_000)) },
      choose: async () => ({ canceled: false, filePath: existing })
    })
    await expect(savePageAs(replaced.browser, replaced.tab)).resolves.toBe(true)
  })

  it('fails rather than waiting forever when the page\'s renderer goes away while it saves', async () => {
    const stuck = harness({ savePage: () => new Promise(() => undefined) })
    const saving = savePageAs(stuck.browser, stuck.tab)
    await vi.waitFor(() => expect(stuck.savePage).toHaveBeenCalledOnce())
    stuck.events.emit('render-process-gone')
    expect(((await saving.catch((error: unknown) => error)) as LocalizedError).key).toBe('appErrors.page.saveFailed')
    expect(stuck.saving.size).toBe(0)
    expect(stuck.events.listenerCount('render-process-gone') + stuck.events.listenerCount('destroyed')).toBe(0)
  })

  it('saves the page the window shows, and nothing without one', async () => {
    const { browser, savePage } = harness()
    await expect(saveShownPage(browser)).resolves.toBe(true)
    expect(savePage).toHaveBeenCalledOnce()
    await expect(saveShownPage({ ...browser, activeTabId: undefined } as unknown as Browser)).resolves.toBe(false)
  })
})
