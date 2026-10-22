import { EventEmitter } from 'node:events'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SaveDialogOptions, SaveDialogReturnValue, WebContents } from 'electron'
import { savedPageFilename, savedPageType, savePageAs, saveShownPage } from '../src/main/browser/page-save/page-save.js'
import type { PageSaveAccess, PageSaveTab } from '../src/main/browser/page-save/page-save-access.js'
import type { LocalizedError } from '../src/main/localized-error.js'

// Hronaut could not save a page: Ctrl/Cmd+S did nothing, and neither the menu nor the page's context menu offered it.

let directory = ''
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'hronaut-save-page-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

function harness(options: {
  access?: Partial<PageSaveAccess<PageSaveTab>>
  tab?: Partial<PageSaveTab>
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
  const tab: PageSaveTab = { id: 'tab', url: 'https://docs.example/guide', sleeping: false, webContents, ...options.tab }
  const saving = new Set<number>()
  const showSaveDialog = vi.fn(options.choose ?? (async () => ({ canceled: false, filePath: join(directory, 'guide.html') })))
  const access: PageSaveAccess<PageSaveTab> = {
    shownTab: () => tab,
    browserContentOccluded: () => false,
    isHumanInteractionLocked: () => false,
    downloadDirectory: () => directory,
    showSaveDialog,
    text: (key) => `text:${key}`,
    savingWebContents: () => saving,
    ...options.access
  }
  return { access, tab, events, savePage, showSaveDialog, saving }
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
    const { access, tab, savePage, showSaveDialog, saving } = harness()
    await expect(savePageAs(access, tab)).resolves.toBe(true)
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
    const { access, tab, savePage } = harness({ choose: async () => ({ canceled: false, filePath: join(directory, 'guide.mhtml') }) })
    await expect(savePageAs(access, tab)).resolves.toBe(true)
    expect(savePage).toHaveBeenCalledExactlyOnceWith(join(directory, 'guide.mhtml'), 'MHTML')
  })

  it('saves nothing when the person cancels', async () => {
    const { access, tab, savePage } = harness({ choose: async () => ({ canceled: true, filePath: '' }) })
    await expect(savePageAs(access, tab)).resolves.toBe(false)
    expect(savePage).not.toHaveBeenCalled()
  })

  it('opens nothing behind trusted chrome, on a locked tab, for Home, a sleeping page or one whose renderer is gone', async () => {
    const refused = [
      harness({ access: { browserContentOccluded: () => true } }),
      harness({ access: { isHumanInteractionLocked: () => true } }),
      harness({ tab: { url: 'hronaut://home/' } }),
      harness({ tab: { sleeping: true } })
    ]
    const crashed = harness()
    ;(crashed.tab.webContents as unknown as { isCrashed: () => boolean }).isCrashed = () => true
    const destroyed = harness()
    ;(destroyed.tab.webContents as unknown as { isDestroyed: () => boolean }).isDestroyed = () => true
    for (const { access, tab, showSaveDialog } of [...refused, crashed, destroyed]) {
      await expect(savePageAs(access, tab)).resolves.toBe(false)
      expect(showSaveDialog).not.toHaveBeenCalled()
    }
  })

  it('opens one save dialog at a time for a page', async () => {
    let choose: (value: SaveDialogReturnValue) => void = () => undefined
    const { access, tab, showSaveDialog } = harness({ choose: () => new Promise((resolve) => { choose = resolve }) })
    const first = savePageAs(access, tab)
    await expect(savePageAs(access, tab)).resolves.toBe(false)
    expect(showSaveDialog).toHaveBeenCalledOnce()
    choose({ canceled: true, filePath: '' })
    await expect(first).resolves.toBe(false)
    const again = savePageAs(access, tab)
    expect(showSaveDialog).toHaveBeenCalledTimes(2)
    choose({ canceled: true, filePath: '' })
    await expect(again).resolves.toBe(false)
  })

  it('does not save another page loaded while the dialog was open, but saves one that changed its own address', async () => {
    let choose: (value: SaveDialogReturnValue) => void = () => undefined
    const chosen = { canceled: false, filePath: join(directory, 'guide.html') }
    const left = harness({ choose: () => new Promise((resolve) => { choose = resolve }) })
    const leaving = savePageAs(left.access, left.tab)
    left.events.emit('did-start-navigation', {}, 'https://docs.example/other', false, true)
    choose(chosen)
    const failure = await leaving.catch((error: unknown) => error)
    expect((failure as LocalizedError).key).toBe('appErrors.page.saveChanged')
    expect(left.savePage).not.toHaveBeenCalled()
    expect(left.events.listenerCount('did-start-navigation')).toBe(0)

    // Nor one that finished loading another page, or crashed and reloaded, while the dialog was open.
    for (const event of ['did-navigate', 'render-process-gone']) {
      const loaded = harness({ choose: () => new Promise((resolve) => { choose = resolve }) })
      const loading = savePageAs(loaded.access, loaded.tab)
      loaded.events.emit(event)
      choose(chosen)
      expect(((await loading.catch((error: unknown) => error)) as LocalizedError).key).toBe('appErrors.page.saveChanged')
      expect(loaded.savePage).not.toHaveBeenCalled()
    }

    const stayed = harness({ choose: () => new Promise((resolve) => { choose = resolve }) })
    const staying = savePageAs(stayed.access, stayed.tab)
    stayed.events.emit('did-start-navigation', {}, 'https://docs.example/guide#setup', true, true)
    stayed.events.emit('did-start-navigation', {}, 'https://ads.example/frame', false, false)
    choose(chosen)
    await expect(staying).resolves.toBe(true)
  })

  it('reports a save that failed, also one Electron reported as done without writing the file', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rejected = harness({ savePage: async () => { throw new Error('net::ERR_FAILED') } })
    const failure = await savePageAs(rejected.access, rejected.tab).catch((error: unknown) => error)
    expect((failure as LocalizedError).key).toBe('appErrors.page.saveFailed')
    expect(rejected.saving.size).toBe(0)
    expect(logged).toHaveBeenCalledOnce()
    logged.mockRestore()

    const unwritten = harness({ savePage: async () => undefined })
    const missing = await savePageAs(unwritten.access, unwritten.tab).catch((error: unknown) => error)
    expect((missing as LocalizedError).key).toBe('appErrors.page.saveFailed')

    // A file the person chose to replace and that stayed as it was is not a saved page either.
    const existing = join(directory, 'existing.html')
    await writeFile(existing, 'older page')
    const unchanged = harness({ savePage: async () => undefined, choose: async () => ({ canceled: false, filePath: existing }) })
    const kept = await savePageAs(unchanged.access, unchanged.tab).catch((error: unknown) => error)
    expect((kept as LocalizedError).key).toBe('appErrors.page.saveFailed')
    const replaced = harness({
      savePage: async (path) => { await utimes(path, new Date(), new Date(Date.now() + 5_000)) },
      choose: async () => ({ canceled: false, filePath: existing })
    })
    await expect(savePageAs(replaced.access, replaced.tab)).resolves.toBe(true)
  })

  it('fails rather than waiting forever when the page\'s renderer goes away while it saves', async () => {
    const stuck = harness({ savePage: () => new Promise(() => undefined) })
    const saving = savePageAs(stuck.access, stuck.tab)
    await vi.waitFor(() => expect(stuck.savePage).toHaveBeenCalledOnce())
    stuck.events.emit('render-process-gone')
    expect(((await saving.catch((error: unknown) => error)) as LocalizedError).key).toBe('appErrors.page.saveFailed')
    expect(stuck.saving.size).toBe(0)
    expect(stuck.events.listenerCount('render-process-gone') + stuck.events.listenerCount('destroyed')).toBe(0)
  })

  it('saves the page the window shows, and nothing without one', async () => {
    const { access, savePage } = harness()
    await expect(saveShownPage(access)).resolves.toBe(true)
    expect(savePage).toHaveBeenCalledOnce()
    await expect(saveShownPage({ ...access, shownTab: () => undefined })).resolves.toBe(false)
  })
})
