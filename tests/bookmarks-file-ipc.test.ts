import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { registerBookmarksFileIpc } from '../src/main/bookmarks-history/bookmarks-file-ipc.js'
import { MAX_IMPORTED_LINKS, type ImportedBookmark } from '../src/main/bookmarks-history/bookmarks-html.js'
import { LocalizedError } from '../src/main/localized-error.js'
import type { BookmarkImportResult } from '../src/shared/types.js'

type Listener = Parameters<IpcMain['handle']>[1]
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-bookmarks-file-'))
  directories.push(directory)
  const listeners = new Map<string, Listener>()
  const result: BookmarkImportResult = { added: 1, alreadySaved: 0, notWebPages: 0, overLimit: 0, limit: 500 }
  const bookmarks = {
    list: vi.fn(() => [{ id: 'a', url: 'https://a.example/', title: 'A', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z' }]),
    collectionSnapshot: vi.fn(() => ({ revision: 1, collections: [{ id: 'work', name: 'Work', bookmarkIds: ['a'] }] })),
    importBookmarks: vi.fn(async (_items: readonly ImportedBookmark[]) => result)
  }
  const host = {
    assertTrustedSender: vi.fn(),
    bookmarks: vi.fn(() => bookmarks),
    pickExportFile: vi.fn(async (_sender: WebContents, _name: string): Promise<string | undefined> => join(directory, 'exported.html')),
    pickImportFile: vi.fn(async (_sender: WebContents): Promise<string | undefined> => join(directory, 'import.html')),
    publishBookmarks: vi.fn(() => []),
    now: () => new Date(2026, 9, 4)
  }
  registerBookmarksFileIpc({ handle: (channel, listener) => { listeners.set(channel, listener) } }, host)
  const event = { sender: { id: 7 } } as unknown as IpcMainInvokeEvent
  const invoke = (channel: string) => Promise.resolve().then(() => listeners.get(channel)!(event))
  const failure = (channel: string) => invoke(channel).then(() => undefined, (error: unknown) => error as LocalizedError)
  return { directory, listeners, host, bookmarks, result, event, invoke, failure }
}

it.each(['bookmarks:export-file', 'bookmarks:import-file'])('refuses an untrusted %s before any dialog opens', async channel => {
  const { host, invoke, event } = await fixture()
  host.assertTrustedSender.mockImplementation(() => { throw new Error('Untrusted') })
  await expect(invoke(channel)).rejects.toThrow('Untrusted')
  expect(host.assertTrustedSender).toHaveBeenCalledWith(event)
  expect(host.pickExportFile).not.toHaveBeenCalled()
  expect(host.pickImportFile).not.toHaveBeenCalled()
  expect(host.bookmarks).not.toHaveBeenCalled()
})

it('exports every bookmark to the file the person picks, named by the day as Chrome names it', async () => {
  const { directory, host, invoke, failure, event } = await fixture()
  expect([...(await fixture()).listeners.keys()]).toEqual(['bookmarks:export-file', 'bookmarks:import-file'])
  await expect(invoke('bookmarks:export-file')).resolves.toBe(1)
  // The dialog opens over the window that asked, which may be a detached panel's.
  expect(host.pickExportFile).toHaveBeenCalledExactlyOnceWith(event.sender, 'bookmarks_10_04_26.html')
  const html = await readFile(join(directory, 'exported.html'), 'utf8')
  expect(html).toContain('<DT><H3>Work</H3>')
  expect(html).toContain('<DT><A HREF="https://a.example/" ADD_DATE="1790848800" LAST_MODIFIED="1790848800">A</A>')

  host.pickExportFile.mockResolvedValueOnce(undefined)
  await expect(invoke('bookmarks:export-file')).resolves.toBeNull()
  // A folder where the file would go cannot be replaced by it.
  await mkdir(join(directory, 'folder.html'))
  host.pickExportFile.mockResolvedValueOnce(join(directory, 'folder.html'))
  const refused = await failure('bookmarks:export-file')
  expect(refused?.key).toBe('appErrors.bookmarks.exportFailed')
  expect(refused?.message).toBe('The bookmarks file could not be saved.')
})

it('imports the bookmarks of the file the person picks and publishes them once', async () => {
  const { directory, host, bookmarks, result, invoke, event } = await fixture()
  // As Windows tools often save it: UTF-16 with a byte order mark.
  await writeFile(join(directory, 'import.html'), Buffer.from('\uFEFF<DL><p><DT><H3>Caf\u00E9</H3><DL><p><DT><A HREF="https://docs.example/">Docs</A></DL><p></DL><p>', 'utf16le'))
  await expect(invoke('bookmarks:import-file')).resolves.toEqual(result)
  expect(host.pickImportFile).toHaveBeenCalledWith(event.sender)
  expect(bookmarks.importBookmarks).toHaveBeenCalledExactlyOnceWith([{ url: 'https://docs.example/', title: 'Docs', folder: 'Caf\u00E9' }])
  expect(host.publishBookmarks).toHaveBeenCalledOnce()
  // Nothing new, so the windows' lists stay as they are.
  bookmarks.importBookmarks.mockResolvedValueOnce({ ...result, added: 0, alreadySaved: 1 })
  await expect(invoke('bookmarks:import-file')).resolves.toMatchObject({ added: 0, alreadySaved: 1 })
  expect(host.publishBookmarks).toHaveBeenCalledOnce()
  host.pickImportFile.mockResolvedValueOnce(undefined)
  await expect(invoke('bookmarks:import-file')).resolves.toBeNull()
  expect(bookmarks.importBookmarks).toHaveBeenCalledTimes(2)
})

it('says why a picked file gives no bookmarks, and imports none from it', async () => {
  const { directory, host, bookmarks, failure } = await fixture()
  const cases: Array<[string, () => Promise<void>, string, string]> = [
    ['huge.html', () => writeFile(join(directory, 'huge.html'), '').then(() => truncate(join(directory, 'huge.html'), 16 * 1024 * 1024 + 1)), 'appErrors.bookmarks.importTooLarge', 'This file is too large to be a bookmarks file.'],
    ['missing.html', async () => undefined, 'appErrors.bookmarks.importUnreadable', 'This file could not be read.'],
    ['folder', () => mkdir(join(directory, 'folder')).then(() => undefined), 'appErrors.bookmarks.importUnreadable', 'This file could not be read.'],
    ['notes.html', () => writeFile(join(directory, 'notes.html'), '<p>No links here</p>'), 'appErrors.bookmarks.importEmpty', 'No bookmarks were found in this file.']
  ]
  for (const [name, prepare, key, message] of cases) {
    await prepare()
    host.pickImportFile.mockResolvedValueOnce(join(directory, name))
    const refused = await failure('bookmarks:import-file')
    expect(refused).toBeInstanceOf(LocalizedError)
    expect([refused?.key, refused?.message]).toEqual([key, message])
  }
  expect(bookmarks.importBookmarks).not.toHaveBeenCalled()
  expect(host.publishBookmarks).not.toHaveBeenCalled()
})

it.runIf(process.platform !== 'win32')('refuses a named pipe without waiting for anything to be written to it', async () => {
  const { directory, host, bookmarks, failure } = await fixture()
  const pipe = join(directory, 'pipe.html')
  execFileSync('mkfifo', [pipe])
  host.pickImportFile.mockResolvedValueOnce(pipe)
  expect((await failure('bookmarks:import-file'))?.key).toBe('appErrors.bookmarks.importUnreadable')
  expect(bookmarks.importBookmarks).not.toHaveBeenCalled()
})

it('counts the links past the most a file is read for as left out, and says when the import cannot be saved', async () => {
  const { directory, host, bookmarks, result, invoke, failure } = await fixture()
  const links = Array.from({ length: MAX_IMPORTED_LINKS + 3 }, (_, index) => `<DT><A HREF="https://e.example/${index}">${index}</A>`)
  await writeFile(join(directory, 'import.html'), `<DL><p>${links.join('\n')}</DL><p>`)
  bookmarks.importBookmarks.mockResolvedValueOnce({ ...result, overLimit: 2 })
  await expect(invoke('bookmarks:import-file')).resolves.toEqual({ ...result, overLimit: 5 })
  expect(bookmarks.importBookmarks.mock.calls[0]?.[0]).toHaveLength(MAX_IMPORTED_LINKS)

  bookmarks.importBookmarks.mockRejectedValueOnce(Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }))
  const refused = await failure('bookmarks:import-file')
  expect([refused?.key, refused?.message]).toEqual(['appErrors.bookmarks.storageUnavailable', 'Bookmark storage is unavailable'])
  expect(host.publishBookmarks).toHaveBeenCalledOnce()
})
