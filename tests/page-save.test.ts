import { EventEmitter } from 'node:events'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SaveDialogOptions, SaveDialogReturnValue, WebContents } from 'electron'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { savedPageFilename, savedPageType, savePageAs, saveShownPage } from '../src/main/browser/page-save/page-save.js'
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
} = {}) {
  const events = new EventEmitter()
  const savePage = vi.fn(options.savePage ?? (async (path: string) => { await writeFile(path, '<html></html>') }))
  const webContents = Object.assign(events, {
    id: 7,
    isDestroyed: () => false,
    isCrashed: () => false,
    getURL: () => 'https://docs.example/guide',
    getTitle: () => 'Guide: Getting started',
    savePage
  }) as unknown as WebContents
  const tab: SaveTab = { id: 'tab', url: 'https://docs.example/guide', sleeping: false, webContents, ...options.tab }
  const saving = new Set<number>()
  const showSaveDialog = vi.fn(options.choose ?? (async () => ({ canceled: false, filePath: join(directory, 'guide.html') })))
  const browser = {
    activeTabId: tab.id,
    tabs: new Map([[tab.id, tab]]),
    browserContentOccluded: options.browser?.occluded === true,
    isHumanInteractionLocked: () => options.browser?.locked === true,
    options: { downloadDirectory: directory },
    window: { isDestroyed: () => false, showSaveDialog },
    text: (key: string) => `text:${key}`,
    pageSaving: saving
  } as unknown as Browser
  return { browser, tab: tab as BrowserTab, events, savePage, showSaveDialog, saving }
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
    await expect(savePageAs(browser, tab)).resolves.toBe(false)
    expect(showSaveDialog).toHaveBeenCalledOnce()
    choose({ canceled: true, filePath: '' })
    await expect(first).resolves.toBe(false)
    const again = savePageAs(browser, tab)
    expect(showSaveDialog).toHaveBeenCalledTimes(2)
    choose({ canceled: true, filePath: '' })
    await expect(again).resolves.toBe(false)
  })

  it('does not save another page loaded while the dialog was open, but saves one that changed its own address', async () => {
    let choose: (value: SaveDialogReturnValue) => void = () => undefined
    const chosen = { canceled: false, filePath: join(directory, 'guide.html') }
    const left = harness({ choose: () => new Promise((resolve) => { choose = resolve }) })
    const leaving = savePageAs(left.browser, left.tab)
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
      loaded.events.emit(event)
      choose(chosen)
      expect(((await loading.catch((error: unknown) => error)) as LocalizedError).key).toBe('appErrors.page.saveChanged')
      expect(loaded.savePage).not.toHaveBeenCalled()
    }

    const stayed = harness({ choose: () => new Promise((resolve) => { choose = resolve }) })
    const staying = savePageAs(stayed.browser, stayed.tab)
    stayed.events.emit('did-start-navigation', {}, 'https://docs.example/guide#setup', true, true)
    stayed.events.emit('did-start-navigation', {}, 'https://ads.example/frame', false, false)
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
