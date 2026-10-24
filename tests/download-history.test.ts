import { EventEmitter } from 'node:events'
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DownloadItem, Session } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DownloadHistoryStore, savedDownloads, type SavedDownload } from '../src/main/browser/download-history/download-history.js'
import { BrowserDownloadsController } from '../src/main/browser/downloads-controller.js'
import type { BrowserDownloadState } from '../src/shared/types.js'

vi.mock('electron', () => ({ shell: { showItemInFolder: vi.fn() } }))
const atomicWrite = vi.hoisted(() => ({ failing: false, calls: 0 }))
vi.mock('../src/main/atomic-file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/atomic-file.js')>()
  return {
    ...actual,
    writeTextFileAtomically: async (...args: Parameters<typeof actual.writeTextFileAtomically>) => {
      atomicWrite.calls += 1
      if (atomicWrite.failing) throw Object.assign(new Error('The file is in use'), { code: 'EBUSY' })
      return actual.writeTextFileAtomically(...args)
    }
  }
})

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  atomicWrite.failing = false
  atomicWrite.calls = 0
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'hronaut-download-history-'))
  cleanups.push(() => rm(path, { recursive: true, force: true }))
  return path
}

function record(overrides: Partial<BrowserDownloadState> = {}): BrowserDownloadState {
  return {
    id: '0b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b',
    url: 'https://download.example/report.pdf',
    filename: 'report.pdf',
    savePath: join(tmpdir(), 'report.pdf'),
    state: 'completed',
    receivedBytes: 10,
    totalBytes: 10,
    startedAt: '2026-10-24T10:00:00.000Z',
    completedAt: '2026-10-24T10:00:01.000Z',
    tabId: 'tab',
    observationGeneration: 3,
    paused: false,
    canResume: false,
    ...overrides
  }
}

const saved = (overrides: Partial<SavedDownload> = {}): SavedDownload => ({
  id: '0b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b',
  url: 'https://download.example/report.pdf',
  filename: 'report.pdf',
  savePath: join(tmpdir(), 'report.pdf'),
  state: 'completed',
  receivedBytes: 10,
  totalBytes: 10,
  startedAt: '2026-10-24T10:00:00.000Z',
  completedAt: '2026-10-24T10:00:01.000Z',
  workspaceId: 'work',
  ...overrides
})

describe('the downloads a restart keeps', () => {
  it('keeps a finished download with its workspace, without its tab or observation', () => {
    expect(savedDownloads([record()], () => 'work')).toEqual([saved()])
  })

  it('keeps one still under way as cancelled, as quitting cancels it, without its progress', () => {
    // So a save while it runs writes nothing new.
    const running = record({ state: 'progressing', receivedBytes: 4, totalBytes: 10, completedAt: undefined, savePath: '/downloads/big.iso', filename: 'big.iso' })
    const paused = record({ id: '1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', state: 'interrupted', paused: true, canResume: true, completedAt: undefined })
    const forms = savedDownloads([running, paused], () => undefined)
    expect(forms.map(({ state, receivedBytes, totalBytes, completedAt }) => ({ state, receivedBytes, totalBytes, completedAt })))
      .toEqual([{ state: 'cancelled', receivedBytes: 0, totalBytes: 0, completedAt: undefined }, { state: 'cancelled', receivedBytes: 0, totalBytes: 0, completedAt: undefined }])
    expect(savedDownloads([{ ...running, receivedBytes: 9 }], () => undefined)).toEqual(savedDownloads([running], () => undefined))
  })

  it('marks a download that did not complete as retryable when its kept address is the one it came from', () => {
    const cancelled = record({ state: 'cancelled', savePath: undefined })
    const running = record({ id: '1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', state: 'progressing', completedAt: undefined })
    const completed = record({ id: '2b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b' })
    expect(savedDownloads([cancelled, running, completed], () => 'work', () => true).map(({ retryable }) => retryable))
      .toEqual([true, true, undefined])
    expect(savedDownloads([cancelled], () => 'work', () => false)[0]).not.toHaveProperty('retryable')
    expect(savedDownloads([cancelled], () => 'work')[0]).not.toHaveProperty('retryable')
  })

  it('keeps the newest 200', () => {
    const downloads = Array.from({ length: 205 }, (_, index) => record({ id: `${String(index).padStart(8, '0')}-2c1d-4e3f-9a8b-7c6d5e4f3a2b` }))
    const forms = savedDownloads(downloads, () => undefined)
    expect(forms).toHaveLength(200)
    expect(forms[0]!.id).toBe(downloads[0]!.id)
  })
})

describe('the saved download history', () => {
  it('is kept readable only by the person and read back', async () => {
    const path = join(await directory(), 'download-history.json')
    const store = new DownloadHistoryStore(path)
    await store.save(() => [saved(), saved({ id: '1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', state: 'interrupted', failureReason: 'destination-unavailable', savePath: undefined })])
    expect((await lstat(path)).mode & 0o777).toBe(0o600)
    expect(await new DownloadHistoryStore(path).load()).toEqual([
      saved(),
      saved({ id: '1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', state: 'interrupted', failureReason: 'destination-unavailable', savePath: undefined })
    ])
  })

  it('does not write what the file holds already, nor anything once the browser closed', async () => {
    const path = join(await directory(), 'download-history.json')
    const store = new DownloadHistoryStore(path)
    await store.save(() => [saved()])
    const written = (await lstat(path)).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 20))
    await store.save(() => [saved()])
    await store.save(() => undefined)
    expect((await lstat(path)).mtimeMs).toBe(written)
  })

  it('leaves out entries that are not downloads Hronaut saved', async () => {
    const path = join(await directory(), 'download-history.json')
    const valid = saved()
    await writeFile(path, JSON.stringify({ version: 1, downloads: [
      valid,
      { ...valid },
      saved({ id: 'not-an-id' }),
      saved({ id: '2b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', filename: '../escape.pdf' }),
      saved({ id: '3b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', savePath: 'relative/report.pdf' }),
      saved({ id: '4b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', state: 'progressing' as SavedDownload['state'] }),
      saved({ id: '5b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', savePath: undefined }),
      saved({ id: '6b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', receivedBytes: -1 }),
      saved({ id: '7b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', url: `https://download.example/${'a'.repeat(5_000)}` }),
      // Hronaut names a saved download after its file.
      saved({ id: '8b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', filename: 'other.pdf' }),
      'not a record'
    ] }))
    expect(await new DownloadHistoryStore(path).load()).toEqual([valid])
  })

  it('reads a time later than now as now, so a clock set back since cannot keep a download first for good', async () => {
    const path = join(await directory(), 'download-history.json')
    await writeFile(path, JSON.stringify({ version: 1, downloads: [saved({ startedAt: '2999-01-01T00:00:00.000Z', completedAt: '2999-01-01T00:00:01.000Z' })] }))
    const before = Date.now()
    const [download] = await new DownloadHistoryStore(path).load()
    expect(Date.parse(download!.startedAt)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(download!.startedAt)).toBeLessThanOrEqual(Date.now())
    expect(download!.completedAt).toBe(download!.startedAt)
  })

  it('removes the file when a save fails, so a download removed since does not come back', async () => {
    // A failed write left the older file, which brought back at the next start what was removed or cleared meanwhile.
    const path = join(await directory(), 'download-history.json')
    const store = new DownloadHistoryStore(path)
    await store.save(() => [saved(), saved({ id: '1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b' })])
    atomicWrite.failing = true
    await expect(store.save(() => [saved()])).rejects.toThrow('The file is in use')
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    // A save after each change does not write again what just failed; the save at quit does.
    const calls = atomicWrite.calls
    await store.save(() => [saved()], false)
    expect(atomicWrite.calls).toBe(calls)
    atomicWrite.failing = false
    await store.save(() => [saved()])
    expect(await new DownloadHistoryStore(path).load()).toEqual([saved()])
  })

  it('reads back the retryable mark only as true, and never on a completed download', async () => {
    const root = await directory()
    const path = join(root, 'download-history.json')
    const cancelled = saved({ state: 'cancelled', savePath: undefined, retryable: true })
    await writeFile(path, JSON.stringify({ version: 1, downloads: [
      cancelled,
      saved({ id: '1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', retryable: true }),
      { ...saved({ id: '2b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', state: 'cancelled' }), retryable: 'yes' }
    ] }))
    const loaded = await new DownloadHistoryStore(path).load()
    expect(loaded.map(({ id, retryable }) => ({ id, retryable })))
      .toEqual([{ id: cancelled.id, retryable: true }, { id: '1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', retryable: undefined }])
  })

  it('gives an interrupted download an end, so it never reads as still under way', async () => {
    const path = join(await directory(), 'download-history.json')
    await writeFile(path, JSON.stringify({ version: 1, downloads: [saved({ state: 'interrupted', completedAt: undefined })] }))
    expect(await new DownloadHistoryStore(path).load()).toEqual([saved({ state: 'interrupted', completedAt: '2026-10-24T10:00:00.000Z' })])
  })

  it('starts empty from a missing, linked, foreign or unreadable file', async () => {
    const root = await directory()
    expect(await new DownloadHistoryStore(join(root, 'missing.json')).load()).toEqual([])
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await writeFile(join(root, 'real.json'), JSON.stringify({ version: 1, downloads: [saved()] }))
    await symlink(join(root, 'real.json'), join(root, 'link.json'))
    expect(await new DownloadHistoryStore(join(root, 'link.json')).load()).toEqual([])
    await writeFile(join(root, 'other.json'), JSON.stringify({ version: 2, downloads: [saved()] }))
    expect(await new DownloadHistoryStore(join(root, 'other.json')).load()).toEqual([])
    await writeFile(join(root, 'broken.json'), '{')
    expect(await new DownloadHistoryStore(join(root, 'broken.json')).load()).toEqual([])
  })
})

describe('the downloads controller keeping its history', () => {
  async function fixture(askWhereToSaveDownloads = false) {
    const root = await directory()
    const path = join(root, 'download-history.json')
    const published: BrowserDownloadState[][] = []
    const session = new EventEmitter()
    const controller = new BrowserDownloadsController({
      getSettings: () => ({ downloadDirectory: root, saveDialogTitle: 'Save', askWhereToSaveDownloads }),
      getSource: () => ({ tabId: 'tab', workspaceId: 'work', observationGeneration: 2 }),
      workspaceObservationGeneration: () => 2,
      isWorkspaceOpen: (workspaceId) => workspaceId === 'work',
      retrySession: () => session as Session,
      allowsAddress: () => true,
      downloadReady: () => undefined,
      isAvailable: () => true,
      publish: (downloads) => { published.push(downloads) }
    })
    cleanups.push(() => controller.destroy())
    controller.attachSession(session as Session)
    const store = new DownloadHistoryStore(path)
    const fileDownloads = async () => (JSON.parse(await readFile(path, 'utf8')) as { downloads: SavedDownload[] }).downloads
    function download(name: string, query = '') {
      const item = new EventEmitter()
      let state: 'progressing' | 'completed' | 'cancelled' = 'progressing'
      let savePath = ''
      Object.assign(item, {
        getURL: () => `https://download.example/${name}${query}`,
        getURLChain: () => [`https://download.example/${name}${query}`],
        getContentDisposition: () => '',
        getFilename: () => name,
        getState: () => state,
        getReceivedBytes: () => 5,
        getTotalBytes: () => 10,
        isPaused: () => false,
        canResume: () => false,
        getSavePath: () => savePath,
        setSavePath: (value: string) => { savePath = value },
        setSaveDialogOptions: () => undefined,
        cancel: () => { state = 'cancelled'; item.emit('done', {}, state) }
      })
      session.emit('will-download', { preventDefault: vi.fn() }, item as DownloadItem, { id: 1 })
      return { item, complete: () => { state = 'completed'; item.emit('done', {}, state) }, cancel: () => (item as unknown as DownloadItem).cancel() }
    }
    return { controller, store, path, published, fileDownloads, download }
  }

  it('lists the downloads kept from before the restart, also to agents of their workspace', async () => {
    const { controller, store } = await fixture()
    controller.restoreHistory([saved(), saved({ id: '1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', workspaceId: 'other', filename: 'other.pdf' })], store)
    // Marked as from before the restart, so the toolbar does not show them as just downloaded.
    expect(controller.listDownloads().map(({ filename, state, fromEarlierRun }) => ({ filename, state, fromEarlierRun })))
      .toEqual([{ filename: 'report.pdf', state: 'completed', fromEarlierRun: true }, { filename: 'other.pdf', state: 'completed', fromEarlierRun: true }])
    expect(controller.manageWorkspaceDownloads('work', 'list').map(({ filename }) => filename)).toEqual(['report.pdf'])
    // Its file's identity was read before the restart, so an agent cannot have a replaced file copied.
    await expect(controller.completedWorkspaceDownloadFile('work', saved().id)).rejects.toThrow('finished before Hronaut restarted')
  })

  it('redacts a kept address again, as a record keeps it', async () => {
    const { controller, store } = await fixture()
    controller.restoreHistory([
      saved({ url: 'https://person:secret@download.example/report.pdf' }),
      saved({ id: '1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', url: 'data:text/csv;base64,c2VjcmV0' })
    ], store)
    const urls = controller.listDownloads().map(({ url }) => url)
    expect(urls[0]).not.toContain('secret')
    expect(urls[1]).toBe('data:text/csv,')
  })

  it('offers Retry for a kept download marked retryable whose address is the same once redacted again', async () => {
    const { controller, store } = await fixture()
    const ids = ['1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', '2b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', '3b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', '4b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b']
    controller.restoreHistory([
      saved({ id: ids[0], state: 'cancelled', retryable: true }),
      saved({ id: ids[1], state: 'cancelled' }),
      // A file the earlier run did not redact, which it would now, is not downloaded again from its redacted address.
      saved({ id: ids[2], state: 'cancelled', retryable: true, url: 'https://download.example/report.pdf?token=secret' }),
      saved({ id: ids[3], state: 'cancelled', retryable: true, workspaceId: 'closed' })
    ], store)
    expect(Object.fromEntries(controller.listDownloads().map(({ id, canRetry }) => [id, canRetry])))
      .toEqual({ [ids[0]!]: true, [ids[1]!]: undefined, [ids[2]!]: undefined, [ids[3]!]: undefined })
  })

  it('saves as retryable a download that did not complete only when nothing in its address was redacted', async () => {
    const { controller, store, fileDownloads, download } = await fixture()
    controller.restoreHistory([saved({ state: 'cancelled', retryable: true })], store)
    download('plain.txt').cancel()
    download('secret.txt', '?token=secret').cancel()
    download('done.txt').complete()
    await controller.saveHistory()
    expect(Object.fromEntries((await fileDownloads()).map(({ filename, retryable }) => [filename, retryable])))
      .toEqual({ 'report.pdf': true, 'plain.txt': true, 'secret.txt': undefined, 'done.txt': undefined })
  })

  it('saves a second after a change, with the kept downloads and a new one', async () => {
    const { controller, store, path, fileDownloads, download } = await fixture()
    vi.useFakeTimers()
    controller.restoreHistory([saved()], store)
    download('new.txt').complete()
    await vi.advanceTimersByTimeAsync(1_000)
    vi.useRealTimers()
    await vi.waitFor(async () => expect((await fileDownloads()).map(({ filename, state }) => ({ filename, state })))
      .toEqual([{ filename: 'new.txt', state: 'completed' }, { filename: 'report.pdf', state: 'completed' }]))
    expect((await lstat(path)).mode & 0o777).toBe(0o600)
  })

  it('saves at quit a download under way as cancelled, and none still waiting for the save dialog', async () => {
    const { controller, store, fileDownloads, download } = await fixture(true)
    controller.restoreHistory([], store)
    const chosen = download('chosen.txt')
    ;(chosen.item as unknown as DownloadItem).setSavePath(join(tmpdir(), 'chosen.txt'))
    chosen.item.emit('updated', {}, 'progressing')
    download('asking.txt')
    await controller.saveHistory()
    expect((await fileDownloads()).map(({ filename, state }) => ({ filename, state }))).toEqual([{ filename: 'chosen.txt', state: 'cancelled' }])
  })

  it('takes a removed record and cleared ones out of the file', async () => {
    const { controller, store, fileDownloads } = await fixture()
    controller.restoreHistory([saved(), saved({ id: '1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', filename: 'other.pdf' })], store)
    controller.removeFinishedDownload('1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b')
    await controller.saveHistory()
    expect((await fileDownloads()).map(({ filename }) => filename)).toEqual(['report.pdf'])
    controller.manageDownloads('clear')
    await controller.saveHistory()
    expect(await fileDownloads()).toEqual([])
  })

  it('does not keep the downloads of a workspace deleted with its data for the next start', async () => {
    // As Recently closed drops its tabs: they stay listed until Hronaut quits.
    const { controller, store, fileDownloads } = await fixture()
    vi.useFakeTimers()
    controller.restoreHistory([saved(), saved({ id: '1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', workspaceId: 'kept', filename: 'other.pdf' }), saved({ id: '2b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b', workspaceId: undefined, filename: 'plain.pdf' })], store)
    controller.forgetWorkspace('work')
    await vi.advanceTimersByTimeAsync(1_000)
    vi.useRealTimers()
    await vi.waitFor(async () => expect((await fileDownloads()).map(({ filename }) => filename)).toEqual(['other.pdf', 'plain.pdf']))
    expect(controller.listDownloads().map(({ filename }) => filename)).toEqual(['report.pdf', 'other.pdf', 'plain.pdf'])
  })

  it('saves nothing before the kept history is back, so a download then cannot replace it', async () => {
    const { controller, path, download } = await fixture()
    await writeFile(path, JSON.stringify({ version: 1, downloads: [saved()] }))
    download('early.txt').complete()
    await controller.saveHistory()
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, downloads: [saved()] })
  })
})
