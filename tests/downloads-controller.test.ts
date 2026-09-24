import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DownloadItem, Session } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserDownloadsController } from '../src/main/browser/downloads-controller.js'

vi.mock('electron', () => ({ shell: { showItemInFolder: vi.fn() } }))

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-download-controller-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const session = new EventEmitter()
  const generations = new Map([['first', 0], ['second', 0]])
  const controller = new BrowserDownloadsController({
    getSettings: () => ({ downloadDirectory: directory, saveDialogTitle: 'Save' }),
    getSource: id => ({ tabId: String(id), workspaceId: id === 1 ? 'first' : 'second', observationGeneration: 0 }),
    workspaceObservationGeneration: id => generations.get(id) ?? 0,
    isAvailable: () => true,
    publish: () => {}
  })
  cleanups.push(() => controller.destroy())
  controller.attachSession(session as Session)
  function download(tabId = 1) {
    const item = new EventEmitter()
    let state: 'progressing' | 'interrupted' | 'completed' | 'cancelled' = 'progressing'
    let savePath = ''
    const cancel = vi.fn(() => {
      state = 'cancelled'
      item.emit('done', {}, state)
    })
    Object.assign(item, {
      getURL: () => 'https://download.example/file.txt',
      getFilename: () => 'file.txt',
      getState: () => state,
      getReceivedBytes: () => 1,
      getTotalBytes: () => 100,
      canResume: () => state === 'interrupted',
      getSavePath: () => savePath,
      setSavePath: (value: string) => { savePath = value },
      cancel
    })
    const event = { preventDefault: vi.fn() }
    session.emit('will-download', event, item as DownloadItem, { id: tabId })
    return {
      event, cancel,
      interrupt: () => { state = 'interrupted'; item.emit('updated', {}, state) },
      complete: () => { state = 'completed'; item.emit('done', {}, state) }
    }
  }
  return { controller, session, generations, download }
}

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
