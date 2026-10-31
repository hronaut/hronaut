import { EventEmitter } from 'node:events'
import * as fsPromises from 'node:fs/promises'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DownloadItem, Session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import { createDownloadsController } from '../src/main/browser/downloads/browser-downloads.js'
import { checkSaveDialogFolder, rememberSaveDialogFolder, saveDialogFolder } from '../src/main/browser/downloads/save-dialog-folder.js'

vi.mock('electron', () => ({
  shell: { showItemInFolder: vi.fn() },
  app: { getFileIcon: vi.fn(async () => ({ isEmpty: () => true })), getPath: vi.fn(() => '/home/person/Documents') },
  nativeImage: { createFromBitmap: vi.fn(() => ({ isEmpty: () => true })) }
}))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, stat: vi.fn(actual.stat), access: vi.fn(actual.access) }
})

// The save dialog of a download, when Hronaut asks where to save, and of Save Page As always opened in the download
// folder; Chrome opens it in the folder the person last saved into.

let root = ''
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'hronaut-save-dialog-folder-')) })
afterEach(async () => {
  vi.mocked(fsPromises.stat).mockReset()
  vi.mocked(fsPromises.access).mockReset()
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(fsPromises.stat).mockImplementation(actual.stat)
  vi.mocked(fsPromises.access).mockImplementation(actual.access)
  await rm(root, { recursive: true, force: true })
})

function browserWith(last: string | null, askWhereToSaveDownloads = true) {
  let kept = last
  const setSaveDialogDirectory = vi.fn((folder: string) => { kept = folder })
  const browser = {
    destroyed: false,
    options: { downloadDirectory: join(root, 'Downloads'), askWhereToSaveDownloads, getSaveDialogDirectory: () => kept, setSaveDialogDirectory },
    text: () => 'Save',
    window: { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } },
    webContentsToTab: new Map(),
    tabs: new Map(),
    mcpTabGroups: new Map(),
    workspacesBeingDeleted: new Set()
  } as unknown as Browser
  return { browser, setSaveDialogDirectory }
}

/** The folder the next save dialog starts in, once the kept folder was looked at. */
async function lookedAt(browser: Browser): Promise<string> {
  await checkSaveDialogFolder(browser)
  return saveDialogFolder(browser)
}

describe('the folder a save dialog starts in', () => {
  it('is the folder the last save dialog saved into, as in Chrome', async () => {
    await mkdir(join(root, 'Projects'))
    expect(await lookedAt(browserWith(join(root, 'Projects')).browser)).toBe(join(root, 'Projects'))
  })

  it('is the download folder until a save dialog saved, or once that folder is gone or is not a folder', async () => {
    await writeFile(join(root, 'file'), '')
    expect(await lookedAt(browserWith(null).browser)).toBe(join(root, 'Downloads'))
    expect(await lookedAt(browserWith(join(root, 'Unplugged drive')).browser)).toBe(join(root, 'Downloads'))
    expect(await lookedAt(browserWith(join(root, 'file')).browser)).toBe(join(root, 'Downloads'))
    expect(await lookedAt(browserWith('relative').browser)).toBe(join(root, 'Downloads'))
    expect(saveDialogFolder({ options: { downloadDirectory: join(root, 'Downloads') } } as unknown as Browser)).toBe(join(root, 'Downloads'))
  })

  it('is the download folder when Hronaut cannot write to that folder, as Chrome does for a download it asks about', async () => {
    await mkdir(join(root, 'Read only'))
    vi.mocked(fsPromises.access).mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
    expect(await lookedAt(browserWith(join(root, 'Read only')).browser)).toBe(join(root, 'Downloads'))
  })

  it('answers at once while the folder takes long to answer, as one on a network share that went away does', () => {
    // It was looked at with a blocking call, which froze the window until the share timed out.
    vi.mocked(fsPromises.stat).mockImplementationOnce(() => new Promise(() => undefined))
    const { browser } = browserWith(join(root, 'Share'))
    expect(saveDialogFolder(browser)).toBe(join(root, 'Downloads'))
    expect(fsPromises.stat).toHaveBeenCalledWith(join(root, 'Share'))
  })

  it('becomes the download folder for the next dialog once the folder is gone', async () => {
    await mkdir(join(root, 'Projects'))
    const { browser } = browserWith(join(root, 'Projects'))
    expect(await lookedAt(browser)).toBe(join(root, 'Projects'))
    await rm(join(root, 'Projects'), { recursive: true })
    // This dialog still starts there, as it looks again only for the next one.
    expect(saveDialogFolder(browser)).toBe(join(root, 'Projects'))
    await checkSaveDialogFolder(browser)
    expect(saveDialogFolder(browser)).toBe(join(root, 'Downloads'))
  })
})

describe('keeping the folder a save dialog saved into', () => {
  it('keeps the folder of the chosen file, once, and starts the next dialog there at once', () => {
    const { browser, setSaveDialogDirectory } = browserWith(null)
    rememberSaveDialogFolder(browser, join(root, 'Projects', 'report.pdf'))
    rememberSaveDialogFolder(browser, join(root, 'Projects', 'notes.txt'))
    expect(setSaveDialogDirectory.mock.calls).toEqual([[join(root, 'Projects')]])
    expect(saveDialogFolder(browser)).toBe(join(root, 'Projects'))
  })

  it('keeps nothing for a path that is not absolute', () => {
    const { browser, setSaveDialogDirectory } = browserWith(null)
    rememberSaveDialogFolder(browser, 'report.pdf')
    expect(setSaveDialogDirectory).not.toHaveBeenCalled()
  })
})

describe('the downloads of a browser being built', () => {
  it('read none of its options, which it is given only after them', () => {
    // The look at the kept folder read them as the browser was built, before it had them: it never ran, so the first
    // save dialog after a restart opened in the download folder, and main was left with a rejected promise.
    const { browser } = browserWith(join(root, 'Projects'))
    const options = vi.fn(() => undefined)
    Object.defineProperty(browser, 'options', { get: options })
    createDownloadsController(browser).destroy()
    expect(options).not.toHaveBeenCalled()
  })
})

describe('a download\'s save dialog', () => {
  function startDownload(browser: Browser) {
    const controller = createDownloadsController(browser)
    const session = new EventEmitter()
    controller.attachSession(session as unknown as Session)
    let savePath = ''
    let dialogPath = ''
    const item = Object.assign(new EventEmitter(), {
      getURL: () => 'https://download.example/report.pdf',
      getURLChain: () => ['https://download.example/report.pdf'],
      getContentDisposition: () => '',
      getFilename: () => 'report.pdf',
      getState: () => 'progressing',
      getReceivedBytes: () => 0,
      getTotalBytes: () => 100,
      isPaused: () => false,
      canResume: () => false,
      getSavePath: () => savePath,
      setSavePath: (value: string) => { savePath = value },
      setSaveDialogOptions: (options: { defaultPath?: string }) => { dialogPath = options.defaultPath ?? '' },
      cancel: vi.fn()
    })
    session.emit('will-download', { preventDefault: vi.fn() }, item as unknown as DownloadItem, null)
    const choose = (path: string) => {
      savePath = path
      item.emit('updated', {}, 'progressing')
    }
    return { controller, dialogPath: () => dialogPath, savePath: () => savePath, choose }
  }

  it('starts in the kept folder and keeps the folder the person saved into, as in Chrome', async () => {
    await mkdir(join(root, 'Projects'))
    const { browser, setSaveDialogDirectory } = browserWith(join(root, 'Projects'))
    await lookedAt(browser)
    const download = startDownload(browser)
    try {
      expect(dirname(download.dialogPath())).toBe(join(root, 'Projects'))
      download.choose(join(root, 'Invoices', 'report.pdf'))
      expect(setSaveDialogDirectory).toHaveBeenCalledExactlyOnceWith(join(root, 'Invoices'))
    } finally {
      download.controller.destroy()
    }
  })

  it('asks where to save, from the Documents folder, when Hronaut cannot write to the download folder, as in Chrome', async () => {
    // It ended as a bare Interrupted.
    await writeFile(join(root, 'Downloads'), 'a file where the folder should be')
    await mkdir(join(root, 'Projects'))
    const { browser, setSaveDialogDirectory } = browserWith(join(root, 'Projects'), false)
    await lookedAt(browser)
    const download = startDownload(browser)
    try {
      expect(dirname(download.dialogPath())).toBe('/home/person/Documents')
      expect(download.savePath()).toBe('')
      // As after any save dialog, the next one starts where the person saved.
      download.choose(join(root, 'Invoices', 'report.pdf'))
      expect(setSaveDialogDirectory).toHaveBeenCalledExactlyOnceWith(join(root, 'Invoices'))
    } finally {
      download.controller.destroy()
    }
  })

  it('makes a download folder that is gone again and saves there without asking, as Chrome does', async () => {
    const { browser } = browserWith(null, false)
    const download = startDownload(browser)
    try {
      expect(download.dialogPath()).toBe('')
      expect(dirname(download.savePath())).toBe(join(root, 'Downloads'))
      expect((await stat(join(root, 'Downloads'))).isDirectory()).toBe(true)
    } finally {
      download.controller.destroy()
    }
  })

  it('neither looks at nor makes the download folder when Hronaut asks where to save each file', async () => {
    const { browser } = browserWith(null)
    const download = startDownload(browser)
    try {
      expect(dirname(download.dialogPath())).toBe(join(root, 'Downloads'))
      await expect(stat(join(root, 'Downloads'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      download.controller.destroy()
    }
  })

  it('leaves a download saved without asking in the download folder, and the kept folder as it was', async () => {
    await mkdir(join(root, 'Projects'))
    await mkdir(join(root, 'Downloads'))
    const { browser, setSaveDialogDirectory } = browserWith(join(root, 'Projects'), false)
    await lookedAt(browser)
    const download = startDownload(browser)
    try {
      expect(dirname(download.savePath())).toBe(join(root, 'Downloads'))
      await new Promise(resolve => setImmediate(resolve))
      expect(setSaveDialogDirectory).not.toHaveBeenCalled()
    } finally {
      download.controller.destroy()
    }
  })
})
