import { existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DownloadItem, Session } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserDownloadsController } from '../src/main/browser/downloads-controller.js'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn(actual.existsSync) }
})

vi.mock('electron', () => ({ shell: { showItemInFolder: vi.fn() } }))

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture(askWhereToSaveDownloads = false) {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-download-controller-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const session = new EventEmitter()
  const generations = new Map([['first', 0], ['second', 0]])
  const controller = new BrowserDownloadsController({
    getSettings: () => ({ downloadDirectory: directory, saveDialogTitle: 'Save', askWhereToSaveDownloads }),
    getSource: id => ({ tabId: String(id), workspaceId: id === 1 ? 'first' : 'second', observationGeneration: 0 }),
    workspaceObservationGeneration: id => generations.get(id) ?? 0,
    isAvailable: () => true,
    publish: () => {}
  })
  cleanups.push(() => controller.destroy())
  controller.attachSession(session as Session)
  function download(tabId = 1, failSetup = false, url = 'https://download.example/file.txt', filename = 'file.txt') {
    const item = new EventEmitter()
    let state: 'progressing' | 'interrupted' | 'completed' | 'cancelled' = 'progressing'
    let savePath = ''
    let paused = false
    const pause = vi.fn(() => { paused = true })
    const resume = vi.fn(() => { paused = false; state = 'progressing' })
    const cancel = vi.fn(() => {
      state = 'cancelled'
      item.emit('done', {}, state)
    })
    Object.assign(item, {
      getURL: () => url,
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
      setSaveDialogOptions: () => {
        if (failSetup) throw new Error('Injected dialog setup failure')
      },
      cancel
    })
    const event = { preventDefault: vi.fn() }
    session.emit('will-download', event, item as DownloadItem, { id: tabId })
    return {
      event, cancel, pause, resume, item,
      interrupt: () => { state = 'interrupted'; item.emit('updated', {}, state) },
      complete: () => { state = 'completed'; item.emit('done', {}, state) }
    }
  }
  return { controller, session, generations, download }
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

it('preserves workspace ownership and excludes a live download from a new observation generation', async () => {
  const { controller, session, generations, download } = await fixture()
  controller.attachSession(session as Session)
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
  controller.attachSession(session as Session)
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
  download()
  expect(controller.listDownloads()[0]?.filename).toBe('file.txt')
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
  expect(() => controller.removeFinishedDownload(target.id)).toThrow('Download record not found')
})

it.each(['progressing', 'paused', 'interrupted'])('rejects removal of a live %s transfer without cancellation', async state => {
  const { controller, download } = await fixture()
  const native = download()
  const id = controller.listDownloads()[0]!.id
  if (state === 'paused') controller.manageDownloads('pause', id)
  if (state === 'interrupted') native.interrupt()
  expect(() => controller.removeFinishedDownload(id)).toThrow('Only finished download records')
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
