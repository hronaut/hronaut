import { existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { access, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { DownloadItem, Session } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserDownloadsController } from '../src/main/browser/downloads-controller.js'
import { LocalizedError } from '../src/main/localized-error.js'
import { translate } from '../src/shared/i18n.js'
import type { BrowserDownloadState } from '../src/shared/types.js'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn(actual.existsSync) }
})

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, access: vi.fn(actual.access) }
})

vi.mock('electron', () => ({ shell: { showItemInFolder: vi.fn() } }))

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture(askWhereToSaveDownloads = false, platform?: NodeJS.Platform) {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-download-controller-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const downloadURL = vi.fn()
  const session = Object.assign(new EventEmitter(), { downloadURL })
  const generations = new Map([['first', 0], ['second', 0]])
  const openWorkspaces = new Set(['first', 'second'])
  const published: BrowserDownloadState[][] = []
  const ready: (number | undefined)[] = []
  const controller = new BrowserDownloadsController({
    getSettings: () => ({ downloadDirectory: directory, saveDialogTitle: 'Save', askWhereToSaveDownloads }),
    getSource: id => ({ tabId: String(id), workspaceId: id === 1 ? 'first' : 'second', observationGeneration: 0 }),
    workspaceObservationGeneration: id => generations.get(id) ?? 0,
    isWorkspaceOpen: id => openWorkspaces.has(id),
    workspaceSession: () => session as unknown as Session,
    downloadReady: id => { ready.push(id) },
    isAvailable: () => true,
    publish: downloads => { published.push(downloads) }
  }, platform)
  cleanups.push(() => controller.destroy())
  controller.attachSession(session as unknown as Session)
  /** A download from the page of tab `tabId`, or from no page with `null`, as a retry starts. */
  function download(tabId: number | null = 1, failSetup = false, url = 'https://download.example/file.txt', filename = 'file.txt', contentDisposition = '', urlChain = [url]) {
    const item = new EventEmitter()
    let state: 'progressing' | 'interrupted' | 'completed' | 'cancelled' = 'progressing'
    let savePath = ''
    let dialogOptions: { defaultPath?: string } = {}
    let paused = false
    const pause = vi.fn(() => { paused = true })
    const resume = vi.fn(() => { paused = false; state = 'progressing' })
    const cancel = vi.fn(() => {
      state = 'cancelled'
      item.emit('done', {}, state)
    })
    Object.assign(item, {
      getURL: () => url,
      getURLChain: () => urlChain,
      getContentDisposition: () => contentDisposition,
      getFilename: () => filename,
      getState: () => state,
      getReceivedBytes: () => 1,
      getTotalBytes: () => 100,
      isPaused: () => paused,
      pause, resume,
      canResume: () => state === 'interrupted',
      getSavePath: () => savePath,
      setSavePath: (value: string) => {
        if (failSetup) throw new Error('Injected native setup failure')
        savePath = value
      },
      setSaveDialogOptions: (options: { defaultPath?: string }) => {
        if (failSetup) throw new Error('Injected dialog setup failure')
        dialogOptions = options
      },
      getSaveDialogOptions: () => dialogOptions,
      cancel
    })
    const event = { preventDefault: vi.fn() }
    session.emit('will-download', event, item as DownloadItem, tabId === null ? null : { id: tabId })
    return {
      event, cancel, pause, resume, item,
      interrupt: () => { state = 'interrupted'; item.emit('updated', {}, state) },
      complete: () => { state = 'completed'; item.emit('done', {}, state) }
    }
  }
  return { controller, session, downloadURL, generations, openWorkspaces, download, published, ready }
}

it('redacts URL credentials and token parameters before exposing download history', async () => {
  const { controller, download } = await fixture()
  const transfer = download(1, false, 'https://person:password@download.example/file.txt?token=secret&view=compact#private')
  expect(controller.listDownloads()[0]?.url).toBe(
    'https://%5BREDACTED%5D:%5BREDACTED%5D@download.example/file.txt?view=compact&token=%5BREDACTED%5D'
  )
  transfer.complete()
  expect(controller.manageWorkspaceDownloads('first', 'list')[0]?.url).not.toContain('secret')
})

it.each([
  ['data:text/csv;base64,' + 'QUJD'.repeat(250_000), 'data:text/csv,'],
  ['data:Image/PNG;base64,' + 'iVBO'.repeat(1_000), 'data:image/png,'],
  ['DATA:,' + 'plain text the page generated'.repeat(1_000), 'data:,'],
  [' data:text/csv,' + 'name,amount%0A'.repeat(1_000), 'data:text/csv,']
])('keeps only the media type of a data: download address, not the file it holds: %#', async (url, expected) => {
  // The whole file stayed in the record, so every list, MCP result and panel update carried it.
  const { controller, download } = await fixture()
  download(1, false, url, 'report.csv')
  expect(controller.listDownloads()[0]?.url).toBe(expected)
  expect(controller.manageWorkspaceDownloads('first', 'list')[0]?.url).toBe(expected)
})

it('cuts a very long download address at 4,096 characters', async () => {
  const { controller, download } = await fixture()
  download(1, false, `https://download.example/file.txt?view=${'a'.repeat(10_000)}`)
  const url = controller.listDownloads()[0]?.url
  expect(url).toHaveLength(4_096)
  expect(url?.startsWith('https://download.example/file.txt?view=aaa')).toBe(true)
})

it('preserves workspace ownership and excludes a live download from a new observation generation', async () => {
  const { controller, session, generations, download } = await fixture()
  controller.attachSession(session as unknown as Session)
  const first = download()
  const second = download(2)
  const [entry] = controller.manageWorkspaceDownloads('first', 'list')
  expect(entry).toBeDefined()
  expect(controller.listDownloads()).toHaveLength(2)
  expect(() => controller.manageWorkspaceDownloads('second', 'cancel', entry!.id)).toThrow('Active download not found')
  expect(first.cancel).not.toHaveBeenCalled()
  first.interrupt()
  generations.set('first', 1)
  controller.advanceWorkspaceObservationGeneration('first', 1)
  expect(controller.manageWorkspaceDownloads('first', 'list')).toEqual([])
  expect(() => controller.manageWorkspaceDownloads('first', 'cancel', entry!.id)).toThrow('Active download not found')
  expect(controller.hasActiveDownload('1')).toBe(true)
  first.complete()
  controller.advanceWorkspaceObservationGeneration('first', 1)
  expect(controller.manageWorkspaceDownloads('first', 'list')).toEqual([
    expect.objectContaining({ id: entry!.id, state: 'completed', observationGeneration: 1 })
  ])
  controller.manageWorkspaceDownloads('first', 'clear')
  expect(controller.listDownloads()).toHaveLength(1)
  expect(second.cancel).not.toHaveBeenCalled()
})

it('records a completed download\'s file for copying, only for its own workspace and while its record lasts', async () => {
  const { controller, download, generations } = await fixture()
  const transfer = download()
  const [entry] = controller.listDownloads()
  await expect(controller.completedWorkspaceDownloadFile('first', entry!.id)).rejects.toThrow('Only a completed download can be copied')
  await writeFile(entry!.savePath!, 'downloaded bytes')
  transfer.complete()
  const file = await controller.completedWorkspaceDownloadFile('first', entry!.id)
  const info = await lstat(entry!.savePath!, { bigint: true })
  expect(file).toEqual({ savePath: entry!.savePath, identity: { dev: String(info.dev), ino: String(info.ino), size: 16, mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs) } })
  await expect(controller.completedWorkspaceDownloadFile('second', entry!.id)).rejects.toThrow('Download not found in this workspace')
  generations.set('first', 1)
  await expect(controller.completedWorkspaceDownloadFile('first', entry!.id)).rejects.toThrow('Download not found in this workspace')
  generations.set('first', 0)
  controller.removeFinishedDownload(entry!.id)
  await expect(controller.completedWorkspaceDownloadFile('first', entry!.id)).rejects.toThrow('Download not found in this workspace')
})

it('records no file for a download whose file was gone, or a symbolic link, when it completed', async () => {
  const { controller, download } = await fixture()
  const missing = download()
  const [missingEntry] = controller.listDownloads()
  missing.complete()
  await expect(controller.completedWorkspaceDownloadFile('first', missingEntry!.id)).rejects.toThrow('no record of this download\'s file')
  const linked = download(1, false, 'https://download.example/linked.txt', 'linked.txt')
  const linkedEntry = controller.listDownloads().find(entry => entry.filename === 'linked.txt')!
  const target = join(dirname(linkedEntry.savePath!), 'link-target.txt')
  await writeFile(target, 'elsewhere')
  await symlink(target, linkedEntry.savePath!)
  linked.complete()
  await expect(controller.completedWorkspaceDownloadFile('first', linkedEntry.id)).rejects.toThrow('no record of this download\'s file')
})

it('retains interrupted transfers at the history limit and admits another download after cancellation', async () => {
  const { controller, download } = await fixture()
  for (let index = 0; index < 200; index += 1) download().interrupt()
  const entries = controller.listDownloads()
  expect(entries).toHaveLength(200)
  expect(new Set(entries.map(entry => entry.savePath)).size).toBe(200)
  expect(controller.manageDownloads('clear')).toHaveLength(200)
  expect(download().event.preventDefault).toHaveBeenCalledOnce()
  controller.manageDownloads('cancel', entries[0]!.id)
  expect(download().event.preventDefault).not.toHaveBeenCalled()
  expect(controller.listDownloads()).toHaveLength(200)
  expect(controller.listDownloads().some(entry => entry.id === entries[0]!.id)).toBe(false)
})

it('releases only its own session and transfer listeners when destroyed', async () => {
  const { controller, session, download } = await fixture()
  const transfer = download()
  const otherSessionListener = vi.fn()
  const otherTransferListener = vi.fn()
  session.on('will-download', otherSessionListener)
  transfer.item.on('updated', otherTransferListener)
  transfer.interrupt()
  const before = controller.listDownloads()

  controller.destroy()
  controller.destroy()

  expect(session.listeners('will-download')).toEqual([otherSessionListener])
  expect(transfer.item.listeners('updated')).toEqual([otherTransferListener])
  expect(transfer.item.listenerCount('done')).toBe(0)
  transfer.complete()
  expect(controller.listDownloads()).toEqual(before)
  controller.attachSession(session as unknown as Session)
  download()
  expect(controller.listDownloads()).toEqual(before)
  expect(otherSessionListener).toHaveBeenCalledOnce()
})

it('releases update listeners as soon as a transfer completes', async () => {
  const { controller, download } = await fixture()
  const transfer = download()
  transfer.complete()
  expect(transfer.item.listenerCount('updated')).toBe(0)
  expect(transfer.item.listenerCount('done')).toBe(0)
  expect(controller.listDownloads()[0]?.state).toBe('completed')
})

it('pauses and resumes live downloads without clearing their history and permits cancellation while paused', async () => {
  const { controller, download } = await fixture()
  const transfer = download()
  const [entry] = controller.listDownloads()
  expect(() => controller.manageDownloads('resume', entry!.id)).toThrow('not paused or resumable')
  expect(controller.manageDownloads('pause', entry!.id)[0]).toMatchObject({ paused: true, canResume: true })
  expect(controller.manageDownloads('clear')).toHaveLength(1)
  expect(controller.manageDownloads('resume', entry!.id)[0]).toMatchObject({ paused: false, canResume: false })
  expect(transfer.resume).toHaveBeenCalledOnce()
  transfer.interrupt()
  expect(() => controller.manageDownloads('pause', entry!.id)).toThrow('Only a progressing')
  expect(controller.manageDownloads('resume', entry!.id)[0]?.state).toBe('progressing')
  controller.manageDownloads('pause', entry!.id)
  expect(controller.manageDownloads('cancel', entry!.id)[0]).toMatchObject({ state: 'cancelled', paused: false, canResume: false })
  expect(() => controller.manageDownloads('resume', entry!.id)).toThrow('Active download not found')
})

it('rejects pause and resume across workspaces and stale observation generations', async () => {
  const { controller, download, generations } = await fixture()
  const transfer = download()
  const [entry] = controller.listDownloads()
  for (const action of ['pause', 'resume'] as const) {
    expect(() => controller.manageWorkspaceDownloads('second', action, entry!.id)).toThrow('Active download not found')
  }
  controller.manageWorkspaceDownloads('first', 'pause', entry!.id)
  generations.set('first', 1)
  for (const action of ['pause', 'resume'] as const) {
    expect(() => controller.manageWorkspaceDownloads('first', action, entry!.id)).toThrow('Active download not found')
  }
  expect(transfer.pause).toHaveBeenCalledOnce()
  expect(transfer.resume).not.toHaveBeenCalled()
})

it.each([false, true])('records native download setup failure without throwing or retaining a live item (dialog=%s)', async dialog => {
  const { controller, download } = await fixture(dialog)
  let rejected!: ReturnType<typeof download>
  expect(() => { rejected = download(1, true) }).not.toThrow()
  expect(rejected.event.preventDefault).toHaveBeenCalledOnce()
  expect(rejected.item.listenerCount('updated')).toBe(0)
  expect(rejected.item.listenerCount('done')).toBe(0)
  expect(controller.hasActiveDownload('1')).toBe(false)
  expect(controller.manageWorkspaceDownloads('first', 'list')).toEqual([
    expect.objectContaining({ state: 'interrupted', failureReason: 'destination-unavailable', completedAt: expect.any(String), canResume: false })
  ])
  expect(controller.manageWorkspaceDownloads('second', 'list')).toEqual([])
  controller.manageDownloads('clear')
  const next = download().item as DownloadItem
  // The save dialog proposes the freed name, and the download is listed once it is chosen.
  expect(basename((dialog ? next.getSaveDialogOptions().defaultPath : next.getSavePath()) ?? '')).toBe('file.txt')
})

it('frees the name of a download whose setup failed in any spelling on macOS', async () => {
  const { controller, download } = await fixture(false, 'darwin')
  download(1, true, 'https://download.example/File.TXT', 'File.TXT')
  controller.manageDownloads('clear')
  download(1, false, 'https://download.example/File.TXT', 'File.TXT')
  expect(controller.listDownloads()[0]?.filename).toBe('File.TXT')
})

it('reserves names that differ only in Unicode normalization as one name on macOS', async () => {
  const { controller, download } = await fixture(false, 'darwin')
  download(1, false, 'https://download.example/cafe.txt', 'caf\u00e9.txt')
  download(1, false, 'https://download.example/cafe.txt', 'cafe\u0301.txt')
  expect(controller.listDownloads().map((item) => item.filename).sort()).toEqual(['caf\u00e9.txt', 'cafe\u0301 (1).txt'].sort())
})

it('rejects an exhausted destination without an uncaught exception or losing existing history', async () => {
  const { controller, download } = await fixture()
  download().complete()
  vi.mocked(existsSync).mockReturnValue(true)
  try {
    expect(() => download()).not.toThrow()
    expect(controller.listDownloads()).toHaveLength(2)
    expect(controller.listDownloads().find(item => item.state === 'interrupted')).toMatchObject({ failureReason: 'destination-unavailable', completedAt: expect.any(String) })
  } finally {
    vi.mocked(existsSync).mockReset()
    vi.mocked(existsSync).mockImplementation((await vi.importActual<typeof import('node:fs')>('node:fs')).existsSync)
  }
})


it('keeps a temporarily non-resumable interrupted transfer active and cancellable until done', async () => {
  const { controller, download } = await fixture()
  const transfer = download()
  Object.assign(transfer.item, { canResume: () => false })
  transfer.interrupt()
  const [entry] = controller.listDownloads()
  expect(entry).toMatchObject({ state: 'interrupted', canResume: false })
  expect(entry?.completedAt).toBeUndefined()
  expect(controller.hasActiveDownload('1')).toBe(true)
  expect(controller.manageDownloads('clear')).toHaveLength(1)
  expect(controller.manageDownloads('cancel', entry!.id)[0]).toMatchObject({
    state: 'cancelled', completedAt: expect.any(String)
  })
  expect(transfer.cancel).toHaveBeenCalledOnce()
  expect(controller.hasActiveDownload('1')).toBe(false)
  expect(controller.manageDownloads('clear')).toEqual([])
})

it('does not reassign a non-resumable interrupted transfer to a new observation generation before done', async () => {
  const { controller, download, generations } = await fixture()
  const transfer = download()
  Object.assign(transfer.item, { canResume: () => false })
  transfer.interrupt()
  controller.listDownloads()
  generations.set('first', 1)
  controller.advanceWorkspaceObservationGeneration('first', 1)
  expect(controller.manageWorkspaceDownloads('first', 'list')).toEqual([])
  transfer.complete()
  controller.advanceWorkspaceObservationGeneration('first', 1)
  expect(controller.manageWorkspaceDownloads('first', 'list')).toEqual([
    expect.objectContaining({ state: 'completed', observationGeneration: 1 })
  ])
})

it.each([
  ['я'.repeat(130) + '.pdf', '.pdf'],
  ['a'.repeat(300) + '.tar', '.tar'],
  ['界'.repeat(100) + '.txt', '.txt'],
  ['b'.repeat(400), ''],
  ['report ' + ' '.repeat(260) + 'end.txt', '.txt']
])('shortens a download name longer than 255 bytes so it can be saved: %#', async (filename, ending) => {
  // The name was kept whole, so creating the file failed with ENAMETOOLONG and the download was interrupted.
  const { controller, download } = await fixture()
  download(1, false, undefined, filename)
  download(1, false, undefined, filename)
  const entries = controller.listDownloads()
  expect(new Set(entries.map(entry => entry.savePath)).size).toBe(2)
  for (const [index, entry] of entries.entries()) {
    expect(Buffer.byteLength(entry.filename)).toBeLessThanOrEqual(255)
    expect(entry.filename.endsWith(ending)).toBe(true)
    expect(entry.filename).not.toMatch(/[ .]\.[a-z]+$|[ .]$/)
    await writeFile(entry.savePath!, String(index), { flag: 'wx' })
  }
  expect(entries.some(entry => / \(1\)(?:\.[a-z]+)?$/.test(entry.filename))).toBe(true)
})

it.each([
  ['CON' + ' '.repeat(300) + 'x.txt', 'download-CON.txt'],
  ['nul' + ' '.repeat(260) + 'report.pdf', 'download-nul.pdf'],
  [' '.repeat(300) + 'x.txt', 'download.txt'],
  ['.'.repeat(300) + 'x', 'download.x']
])('names a shortened download that would be a Windows device or empty: %#', async (filename, expected) => {
  const { controller, download } = await fixture()
  download(1, false, undefined, filename)
  expect(controller.listDownloads()[0]).toMatchObject({ filename: expected, state: 'progressing' })
})

it('shortens a download name of 20,000 characters in one pass', async () => {
  // Shortening dropped one character at a time and measured the whole name again: seconds for a name this long, and
  // minutes for the longest a page can suggest, with the main process blocked. One pass takes about a millisecond.
  const { controller, download } = await fixture()
  const started = performance.now()
  download(1, false, undefined, 'a'.repeat(10_000) + ' '.repeat(10_000) + 'b.pdf')
  download(1, false, undefined, 'a'.repeat(10_000) + ' '.repeat(10_000) + 'b.pdf')
  expect(performance.now() - started).toBeLessThan(1_000)
  const names = controller.listDownloads().map(entry => entry.filename).sort()
  expect(names).toEqual(['a'.repeat(251) + '.pdf', 'a'.repeat(247) + ' (1).pdf'].sort())
})

it.each(['a'.repeat(251) + '.txt', '界'.repeat(83) + 'ab.txt', '😀'.repeat(62) + 'abc.txt'])(
  'saves duplicate maximum-length download names without overwriting or splitting Unicode: %s',
  async filename => {
    const { controller, download } = await fixture()
    const first = download(1, false, undefined, filename)
    const second = download(1, false, undefined, filename)
    const entries = controller.listDownloads()
    expect(entries).toHaveLength(2)
    const paths = entries.map(entry => entry.savePath!)
    expect(new Set(paths).size).toBe(2)
    expect(entries.some(entry => entry.filename === filename)).toBe(true)
    expect(entries.some(entry => entry.filename.endsWith(' (1).txt'))).toBe(true)
    for (const [index, entry] of entries.entries()) {
      expect(Buffer.byteLength(entry.filename)).toBeLessThanOrEqual(255)
      expect(Buffer.from(entry.filename).toString()).toBe(entry.filename)
      await writeFile(entry.savePath!, String(index), { flag: 'wx' })
    }
    for (const [index, path] of paths.entries()) expect(await readFile(path, 'utf8')).toBe(String(index))
    // Finished reservations must still be protected by the files on disk.
    first.complete()
    second.complete()
    download(1, false, undefined, filename)
    expect(controller.listDownloads().some(entry => entry.filename.endsWith(' (2).txt'))).toBe(true)
  }
)

it.each([
  ['release.tar.gz', 'release (1).tar.gz'],
  ['backup.sql.GZ', 'backup (1).sql.GZ'],
  ['logs.tar.bz2', 'logs (1).tar.bz2'],
  ['disk.img.xz', 'disk (1).img.xz'],
  ['notes.gz', 'notes (1).gz'],
  ['dump.archive.gz', 'dump.archive (1).gz'],
  ['my.photos.zip', 'my.photos (1).zip'],
  ['zstd-1.5.6.tar.zst', 'zstd-1.5.6 (1).tar.zst'],
  ['src.tar.lzma', 'src (1).tar.lzma'],
  ['old.tar.Z', 'old (1).tar.Z'],
  ['x.abcd.gz', 'x (1).abcd.gz'],
  ['x.abcde.gz', 'x.abcde (1).gz'],
  ['script.User.JS', 'script (1).User.JS'],
  ['CON.tar.gz', 'download-CON (1).tar.gz'],
  ['.tar.gz', '.tar (1).gz']
])('names a second %s download before its compressed archive extension', async (filename, secondName) => {
  // A second `release.tar.gz` was saved as `release.tar (1).gz`, which unpacks to a file that has lost its `.tar`.
  const { controller, download } = await fixture()
  download(1, false, undefined, filename)
  download(1, false, undefined, filename)
  const firstName = filename.startsWith('CON.') ? `download-${filename}` : filename
  expect(controller.listDownloads().map(entry => entry.filename).sort()).toEqual([firstName, secondName].sort())
})

it('keeps both extensions of a compressed archive whose name is shortened', async () => {
  const { controller, download } = await fixture()
  download(1, false, undefined, 'a'.repeat(300) + '.tar.gz')
  download(1, false, undefined, 'a'.repeat(300) + '.tar.gz')
  expect(controller.listDownloads().map(entry => entry.filename).sort())
    .toEqual(['a'.repeat(248) + '.tar.gz', 'a'.repeat(244) + ' (1).tar.gz'].sort())
  download(1, false, undefined, ' '.repeat(300) + '.tar.gz')
  expect(controller.listDownloads().map(entry => entry.filename)).toContain('download.tar.gz')
})

it.each([
  ['darwin', 'report (1).pdf'],
  ['win32', 'report (1).pdf'],
  ['linux', 'report.pdf']
] as const)('keeps simultaneous downloads whose names differ only in letter case apart as the %s file system does', async (platform, secondName) => {
  const { controller, download } = await fixture(false, platform)
  const filenames = () => controller.listDownloads().map(entry => entry.filename)
  // Chromium has created neither file yet, as when a page starts both downloads at once.
  const first = download(1, false, 'https://download.example/Report.pdf', 'Report.pdf')
  download(1, false, 'https://download.example/report.pdf', 'report.pdf')
  expect(filenames().sort()).toEqual(['Report.pdf', secondName])
  // A finished download releases its name in any spelling; only its file on disk protects it after that.
  first.complete()
  download(1, false, 'https://download.example/REPORT.PDF', 'REPORT.PDF')
  expect(filenames()).toContain('REPORT.PDF')
})

it('saves a link under its download name with Save Link As unless the server names the file', async () => {
  // Electron's downloadURL cannot carry the name, so Save Link As saved `/export?id=5` as export.csv, not report.csv.
  const { controller, download } = await fixture()
  const savedAs = (transfer: { item: unknown }) => basename((transfer.item as DownloadItem).getSavePath())
  controller.expectSavedLinkName(1, 'https://download.example/export?id=5#top', 'report.csv')
  expect(savedAs(download(2, false, 'https://download.example/export?id=5', 'export.csv'))).toBe('export.csv')
  expect(savedAs(download(1, false, 'https://download.example/export?id=5', 'export.csv'))).toBe('report.csv')
  // The name is used once, by the download it was given for.
  expect(savedAs(download(1, false, 'https://download.example/export?id=5', 'export.csv'))).toBe('export (1).csv')
  controller.expectSavedLinkName(1, 'https://download.example/export?id=6', 'mine.csv')
  expect(savedAs(download(1, false, 'https://download.example/export?id=6', 'server.csv', 'attachment; filename="server.csv"'))).toBe('server.csv')
  expect(controller.listDownloads().map(entry => entry.filename).sort()).toEqual(['export (1).csv', 'export.csv', 'report.csv', 'server.csv'])
})

it('keeps the address\'s name when a saved link redirects to another site', async () => {
  // Hronaut saves without asking, so a redirect elsewhere must not name the file it serves, as a click's does not:
  // a same-origin redirector could otherwise save another site's reflected response as update.bat.
  const { controller, download } = await fixture()
  const savedAs = (transfer: { item: unknown }) => basename((transfer.item as DownloadItem).getSavePath())
  controller.expectSavedLinkName(1, 'https://download.example/go?u=x', 'update.bat')
  expect(savedAs(download(1, false, 'https://cdn.example/jsonp', 'jsonp.js', '', ['https://download.example/go?u=x', 'https://cdn.example/jsonp']))).toBe('jsonp.js')
  // The name was used up by that download.
  expect(savedAs(download(1, false, 'https://download.example/go?u=x', 'go.bin'))).toBe('go.bin')
  controller.expectSavedLinkName(1, 'https://download.example/export?id=5', 'report.csv')
  expect(savedAs(download(1, false, 'https://download.example/files/5', '5.csv', '', ['https://download.example/export?id=5', 'https://download.example/files/5']))).toBe('report.csv')
})

it('proposes a saved link\'s name when Hronaut asks where to save it', async () => {
  const { controller, download } = await fixture(true)
  controller.expectSavedLinkName(1, 'https://download.example/export?id=5', 'report.csv')
  const transfer = download(1, false, 'https://download.example/export?id=5', 'export.csv')
  const proposed = (transfer.item as DownloadItem).getSaveDialogOptions().defaultPath ?? ''
  expect(basename(proposed)).toBe('report.csv')
  ;(transfer.item as DownloadItem).setSavePath(proposed)
  transfer.item.emit('updated', {}, 'progressing')
  expect(controller.listDownloads()[0]?.filename).toBe('report.csv')
})

it('lists a download once the person chose where to save it, and none they cancelled in the save dialog, as Chrome', async () => {
  // The Downloads panel opened behind the save dialog, and cancelling the dialog left a Cancelled row with no file.
  const { controller, download, published } = await fixture(true)
  const cancelled = download(1, false, 'https://download.example/cancelled.txt', 'cancelled.txt')
  const chosen = download(1, false, 'https://download.example/chosen.txt', 'chosen.txt')
  expect(controller.listDownloads()).toEqual([])
  expect(controller.manageWorkspaceDownloads('first', 'list')).toEqual([])
  expect(published.at(-1)).toEqual([])

  cancelled.cancel()
  chosen.item.emit('updated', {}, 'progressing')
  expect(controller.listDownloads()).toEqual([])
  ;(chosen.item as DownloadItem).setSavePath(join(tmpdir(), 'chosen.txt'))
  chosen.item.emit('updated', {}, 'progressing')
  // Published at once, so the panel opens as the dialog closes.
  expect(published.at(-1)?.map(({ filename, state }) => ({ filename, state }))).toEqual([{ filename: 'chosen.txt', state: 'progressing' }])
  chosen.complete()
  expect(controller.manageWorkspaceDownloads('first', 'list').map(({ filename, state }) => ({ filename, state })))
    .toEqual([{ filename: 'chosen.txt', state: 'completed' }])
})

it('keeps a download that has its file when it is cancelled, as Chrome lists it as Cancelled', async () => {
  const { controller, download } = await fixture(true)
  const transfer = download(1, false, 'https://download.example/kept.txt', 'kept.txt')
  ;(transfer.item as DownloadItem).setSavePath(join(tmpdir(), 'kept.txt'))
  transfer.item.emit('updated', {}, 'progressing')
  controller.manageDownloads('cancel', controller.listDownloads()[0]!.id)
  expect(controller.listDownloads().map(({ filename, state }) => ({ filename, state }))).toEqual([{ filename: 'kept.txt', state: 'cancelled' }])
})

it('uses up a saved link\'s name when a full history refuses its download', async () => {
  // The name stayed, so the next download of that address from the tab took it.
  const { controller, download } = await fixture()
  const transfers = Array.from({ length: 200 }, (_, index) => download(1, false, `https://download.example/${index}.txt`, `${index}.txt`))
  controller.expectSavedLinkName(1, 'https://download.example/export?id=5', 'report.csv')
  expect(download(1, false, 'https://download.example/export?id=5', 'export.csv').event.preventDefault).toHaveBeenCalled()
  transfers[0]!.complete()
  const next = download(1, false, 'https://download.example/export?id=5', 'export.csv')
  expect(next.event.preventDefault).not.toHaveBeenCalled()
  expect(basename((next.item as DownloadItem).getSavePath())).toBe('export.csv')
})

it('removes only the selected finished record and preserves both downloaded files', async () => {
  const { controller, download } = await fixture()
  const first = download(1, false, undefined, 'first.txt')
  first.complete()
  download(2, false, undefined, 'second.txt').complete()
  const before = controller.listDownloads()
  const target = before.find(item => item.filename === 'first.txt')!
  for (const item of before) await writeFile(item.savePath!, 'synthetic saved bytes')
  const result = controller.removeFinishedDownload(target.id)
  expect(result.map(item => item.id)).toEqual(before.filter(item => item.id !== target.id).map(item => item.id))
  for (const item of before) expect(await readFile(item.savePath!, 'utf8')).toBe('synthetic saved bytes')
  expect(first.cancel).not.toHaveBeenCalled()
  expect(() => controller.removeFinishedDownload(target.id)).toThrow('This download is no longer in the list.')
})

it.each(['progressing', 'paused', 'interrupted'])('rejects removal of a live %s transfer without cancellation', async state => {
  const { controller, download } = await fixture()
  const native = download()
  const id = controller.listDownloads()[0]!.id
  if (state === 'paused') controller.manageDownloads('pause', id)
  if (state === 'interrupted') native.interrupt()
  expect(() => controller.removeFinishedDownload(id)).toThrow('Cancel this download before removing it.')
  expect(controller.listDownloads()).toHaveLength(1)
  expect(native.cancel).not.toHaveBeenCalled()
})

it('can remove cancelled and terminal interrupted records', async () => {
  const { controller, download } = await fixture()
  download().cancel()
  download(2, true)
  const before = controller.listDownloads()
  expect(before.map(item => item.state).sort()).toEqual(['cancelled', 'interrupted'])
  for (const item of before) {
    expect(item.completedAt).toBeTruthy()
    controller.removeFinishedDownload(item.id)
  }
  expect(controller.listDownloads()).toEqual([])
})

function thrown(action: () => unknown): LocalizedError {
  try { action() } catch (error) { if (error instanceof LocalizedError) return error; throw error }
  throw new Error('Expected a LocalizedError')
}

/** Holds the next file check until `answer` settles it, as a slow network folder would. */
function holdNextFileCheck() {
  cleanups.push(() => { vi.mocked(access).mockReset() })
  let answer!: (present: boolean) => void
  vi.mocked(access).mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
    answer = present => present ? resolve() : reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
  }))
  return { answer: (present: boolean) => answer(present) }
}

it('marks a finished download whose file was moved or deleted, and clears the mark once it is back', async () => {
  const { controller, download, published } = await fixture()
  download().complete()
  const savePath = controller.listDownloads()[0]!.savePath!
  await writeFile(savePath, 'saved')
  controller.listDownloadsCheckingFiles()
  await vi.waitFor(() => expect(access).toHaveBeenCalledWith(savePath))
  const before = published.length
  await rm(savePath)
  // The Downloads panel kept showing the file as complete and offering Show in folder, which then failed.
  expect(controller.listDownloadsCheckingFiles()[0]).not.toHaveProperty('fileRemoved')
  await vi.waitFor(() => expect(controller.listDownloads()[0]?.fileRemoved).toBe(true))
  await vi.waitFor(() => expect(published.slice(before).map(downloads => downloads[0]?.fileRemoved)).toEqual([true]))
  await writeFile(savePath, 'back')
  controller.listDownloadsCheckingFiles()
  await vi.waitFor(() => expect(published.at(-1)?.[0]).not.toHaveProperty('fileRemoved'))
  expect(published).toHaveLength(before + 2)
})

it('checks again after a check already running instead of beside it, one file at a time', async () => {
  const { controller, download } = await fixture()
  download(1, false, 'https://download.example/a.txt', 'a.txt').complete()
  download(1, false, 'https://download.example/b.txt', 'b.txt').complete()
  // The checks the downloads started have settled.
  await new Promise(resolve => setTimeout(resolve, 20))
  vi.mocked(access).mockClear()
  const held = holdNextFileCheck()
  controller.listDownloadsCheckingFiles()
  controller.listDownloadsCheckingFiles()
  controller.listDownloadsCheckingFiles()
  // Opening the panel three times started 200 checks each, all at once, on Node's four file threads.
  expect(access).toHaveBeenCalledOnce()
  held.answer(true)
  await vi.waitFor(() => expect(access).toHaveBeenCalledTimes(4))
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(access).toHaveBeenCalledTimes(4)
})

it('keeps the newer answer when a slow check of the same file settles later', async () => {
  const { controller, download } = await fixture()
  download().complete()
  const [entry] = controller.listDownloads()
  await new Promise(resolve => setTimeout(resolve, 20))
  const held = holdNextFileCheck()
  controller.listDownloadsCheckingFiles()
  // Show in folder found the file gone while the panel's check was still waiting on a slow folder.
  await expect(controller.showDownloadInFolder(entry!.id)).rejects.toThrow('This file was moved or deleted')
  expect(controller.listDownloads()[0]?.fileRemoved).toBe(true)
  held.answer(true)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(controller.listDownloads()[0]?.fileRemoved).toBe(true)
})

it('keeps a record removed while its file is checked out of the list, with nothing more published', async () => {
  const { controller, download, published } = await fixture()
  download().complete()
  await new Promise(resolve => setTimeout(resolve, 20))
  const held = holdNextFileCheck()
  controller.listDownloadsCheckingFiles()
  controller.removeFinishedDownload(controller.listDownloads()[0]!.id)
  const removal = published.length
  held.answer(false)
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(controller.listDownloads()).toEqual([])
  expect(published).toHaveLength(removal)
})

it('checks finished files when a new download opens the panel', async () => {
  const { controller, download } = await fixture()
  download(1, false, 'https://download.example/a.txt', 'a.txt').complete()
  const savePath = controller.listDownloads()[0]!.savePath!
  await writeFile(savePath, 'saved')
  await rm(savePath)
  download(1, false, 'https://download.example/b.txt', 'b.txt')
  await vi.waitFor(() => expect(controller.listDownloads().find(item => item.filename === 'a.txt')?.fileRemoved).toBe(true))
})

it('opens the folder of a finished file and says when the file was moved or deleted', async () => {
  const { shell } = await import('electron')
  const { controller, download, published } = await fixture()
  download().complete()
  const [entry] = controller.listDownloads()
  await writeFile(entry!.savePath!, 'saved')
  vi.mocked(shell.showItemInFolder).mockClear()
  await controller.showDownloadInFolder(entry!.id)
  expect(shell.showItemInFolder).toHaveBeenCalledExactlyOnceWith(entry!.savePath)
  await rm(entry!.savePath!)
  const failure = await controller.showDownloadInFolder(entry!.id).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(LocalizedError)
  expect((failure as LocalizedError).key).toBe('appErrors.downloads.fileRemoved')
  expect((failure as Error).message).toBe('This file was moved or deleted, so it cannot be shown in its folder.')
  expect(shell.showItemInFolder).toHaveBeenCalledOnce()
  expect(published.at(-1)?.[0]?.fileRemoved).toBe(true)
  await expect(controller.showDownloadInFolder('gone')).rejects.toThrow('This download is no longer in the list.')
})

it('names transfer failures for the panel while agents keep reading the same messages', async () => {
  const { controller, download } = await fixture()
  const native = download()
  const id = controller.listDownloads()[0]!.id
  // The panel showed these in English, whatever the interface language.
  const notResumable = thrown(() => controller.manageDownloads('resume', id))
  expect([notResumable.key, notResumable.message]).toEqual(['appErrors.downloads.notResumable', 'Download is not paused or resumable'])
  native.interrupt()
  const notProgressing = thrown(() => controller.manageDownloads('pause', id))
  expect([notProgressing.key, notProgressing.message]).toEqual(['appErrors.downloads.notProgressing', 'Only a progressing download can be paused'])
  native.complete()
  const notActive = thrown(() => controller.manageWorkspaceDownloads('first', 'cancel', id))
  expect([notActive.key, notActive.message]).toEqual(['appErrors.downloads.notActive', `Active download not found: ${id}`])
  expect(translate('de-DE', notActive.key)).toBe('Dieser Download ist bereits beendet oder abgebrochen.')
})

it('settles when the downloads of a session that have not ended do, for a closed workspace to delete the rest of its storage', async () => {
  const { controller, session, download } = await fixture()
  const otherSession = new EventEmitter()
  controller.attachSession(otherSession as Session)
  expect(controller.downloadsEnd(session as unknown as Session)).toBeUndefined()

  download().complete()
  expect(controller.downloadsEnd(session as unknown as Session)).toBeUndefined()
  const receiving = download()
  const paused = download(2)
  paused.pause()
  const interrupted = download()
  interrupted.interrupt()
  // A paused download, and one Chromium can resume, can still be resumed, so they are waited for too; another
  // session's are not.
  expect(controller.downloadsEnd(otherSession as Session)).toBeUndefined()
  let ended = false
  const end = controller.downloadsEnd(session as unknown as Session)!.then(() => { ended = true })
  const turn = () => new Promise<void>((resolve) => { setImmediate(resolve) })
  receiving.complete()
  paused.cancel()
  await turn()
  expect(ended).toBe(false)
  interrupted.cancel()
  await end
  expect(ended).toBe(true)
  expect(controller.downloadsEnd(session as unknown as Session)).toBeUndefined()
})

it('tells the tab manager once that a download has its file, at once or after the save dialog, and when it ends first', async () => {
  // The tab manager closes a tab a download left empty then, as Chrome does once the file is chosen.
  const saving = await fixture()
  const transfer = saving.download(1)
  expect(saving.ready).toEqual([1])
  transfer.interrupt()
  transfer.complete()
  saving.download(2, true)
  expect(saving.ready).toEqual([1, 2])

  const asking = await fixture(true)
  const chosen = asking.download(1)
  chosen.item.emit('updated', {}, 'progressing')
  expect(asking.ready).toEqual([])
  ;(chosen.item as DownloadItem).setSavePath(join(tmpdir(), 'chosen.txt'))
  chosen.item.emit('updated', {}, 'progressing')
  chosen.item.emit('updated', {}, 'progressing')
  expect(asking.ready).toEqual([1])
  asking.download(2).cancel()
  expect(asking.ready).toEqual([1, 2])

  // A download a full history refuses leaves its tab as empty as one the person cancels.
  const full = await fixture()
  for (let index = 0; index < 200; index += 1) full.download(1, false, `https://download.example/${index}.txt`, `${index}.txt`)
  expect(full.download(2).event.preventDefault).toHaveBeenCalled()
  expect(full.ready.at(-1)).toBe(2)
})

it('offers Retry for a cancelled download and downloads its full address again in its workspace, as Chrome', async () => {
  const { controller, downloadURL, download } = await fixture()
  const url = 'https://download.example/file.txt?token=secret'
  const cancelled = download(1, false, url)
  const [listedWhileRunning] = controller.listDownloads()
  expect(listedWhileRunning?.canRetry).toBeUndefined()
  cancelled.cancel()
  const [record] = controller.listDownloads()
  expect(record).toMatchObject({ state: 'cancelled', canRetry: true })
  // The record keeps its address redacted; only the retry uses it in full.
  expect(record?.url).not.toContain('secret')
  const listed = controller.manageDownloads('retry', record!.id)
  expect(downloadURL).toHaveBeenCalledExactlyOnceWith(url)
  expect(listed.map(({ id }) => id)).toEqual([record!.id])

  // Started from no page, the retry is the workspace's download, beside the old row.
  download(null, false, url).complete()
  const downloads = controller.listDownloads()
  const again = downloads.find(({ id }) => id !== record!.id)
  expect(downloads).toHaveLength(2)
  expect(downloads.find(({ id }) => id === record!.id)).toMatchObject({ state: 'cancelled', canRetry: true })
  expect(again).toMatchObject({ state: 'completed', filename: 'file.txt' })
  expect(again?.canRetry).toBeUndefined()
  expect(controller.manageWorkspaceDownloads('first', 'list').map(({ id }) => id).sort()).toEqual([again!.id, record!.id].sort())
  expect(controller.manageWorkspaceDownloads('second', 'list')).toEqual([])
})

it('offers Retry for a failed download and for one whose folder could not be written', async () => {
  const { controller, download } = await fixture()
  const failed = download(1, false, 'https://download.example/failed.txt', 'failed.txt')
  failed.interrupt()
  // Chromium can still resume this one, so it offers Resume instead.
  expect(controller.listDownloads()[0]?.canRetry).toBeUndefined()
  failed.item.emit('done', {}, 'interrupted')
  expect(controller.listDownloads()[0]).toMatchObject({ state: 'interrupted', canRetry: true })
  download(1, true, 'https://download.example/unwritable.txt', 'unwritable.txt')
  expect(controller.listDownloads().find(({ filename }) => filename === 'unwritable.txt'))
    .toMatchObject({ state: 'interrupted', failureReason: 'destination-unavailable', canRetry: true })
})

it('does not offer Retry for a completed download, a blob: or data: address, a page with no workspace, or a closed workspace', async () => {
  const { controller, downloadURL, openWorkspaces, download } = await fixture()
  download(1, false, 'https://download.example/done.txt', 'done.txt').complete()
  download(1, false, 'blob:https://download.example/1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', 'blob.txt').cancel()
  download(1, false, 'data:text/plain,hello', 'data.txt').cancel()
  download(2, false, 'https://download.example/closed.txt', 'closed.txt').cancel()
  openWorkspaces.delete('second')
  expect(controller.listDownloads().filter(({ canRetry }) => canRetry)).toEqual([])
  for (const { id } of controller.listDownloads()) {
    expect(() => controller.manageDownloads('retry', id)).toThrow(LocalizedError)
  }
  expect(() => controller.manageDownloads('retry', 'missing')).toThrow('Download cannot be retried: missing')
  expect(downloadURL).not.toHaveBeenCalled()
})

it('lets an agent retry only its own workspace\'s downloads, and forgets the address of a removed record', async () => {
  const { controller, downloadURL, download } = await fixture()
  download(1, false, 'https://download.example/file.txt').cancel()
  const [record] = controller.listDownloads()
  expect(() => controller.manageWorkspaceDownloads('second', 'retry', record!.id)).toThrow('Download cannot be retried')
  expect(() => controller.manageWorkspaceDownloads('first', 'retry')).toThrow('downloadId is required to retry a download')
  expect(controller.manageWorkspaceDownloads('first', 'retry', record!.id)[0]?.canRetry).toBe(true)
  expect(downloadURL).toHaveBeenCalledOnce()
  controller.removeFinishedDownload(record!.id)
  expect(() => controller.manageDownloads('retry', record!.id)).toThrow('Download cannot be retried')
})

it('gives a retry\'s workspace only to a download of its own address that no page started', async () => {
  const { controller, download } = await fixture()
  download(1, false, 'https://download.example/file.txt').cancel()
  controller.manageDownloads('retry', controller.listDownloads()[0]!.id)
  // Another download from no page, which the fixture's pages would put in the second workspace.
  download(null, false, 'https://download.example/other.txt', 'other.txt')
  // A page's own download of the same address is the page's.
  download(2, false, 'https://download.example/file.txt')
  expect(controller.manageWorkspaceDownloads('first', 'list')).toHaveLength(1)
  expect(controller.manageWorkspaceDownloads('second', 'list')).toHaveLength(2)
  download(null, false, 'https://download.example/file.txt')
  expect(controller.manageWorkspaceDownloads('first', 'list').map(({ state }) => state).sort()).toEqual(['cancelled', 'progressing'])
  // The retry was taken, so the next such download is no longer the first workspace's.
  download(null, false, 'https://download.example/file.txt')
  expect(controller.manageWorkspaceDownloads('first', 'list')).toHaveLength(2)
  expect(controller.manageWorkspaceDownloads('second', 'list')).toHaveLength(3)
})

it('gives a retry that has not started yet to the workspace its downloads move to', async () => {
  const { controller, download } = await fixture()
  download(1, false, 'https://download.example/file.txt').cancel()
  controller.manageDownloads('retry', controller.listDownloads()[0]!.id)
  controller.remapDownloadWorkspaceOwnership('first', 'second')
  download(null, false, 'https://download.example/file.txt')
  expect(controller.manageWorkspaceDownloads('first', 'list')).toEqual([])
  expect(controller.manageWorkspaceDownloads('second', 'list').map(({ state }) => state).sort()).toEqual(['cancelled', 'progressing'])
})
