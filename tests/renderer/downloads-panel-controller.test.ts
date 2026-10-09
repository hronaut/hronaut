import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useDownloadsPanelController } from '../../src/renderer/src/composables/useDownloadsPanelController.js'
import type { BrowserDownloadState } from '../../src/shared/types.js'

function download(
  id: string,
  state: BrowserDownloadState['state'] = 'progressing',
  receivedBytes = 50,
  totalBytes = 100
): BrowserDownloadState {
  return {
    id,
    url: `https://example.test/${id}`,
    filename: `${id}.bin`,
    state,
    receivedBytes,
    totalBytes,
    startedAt: '2026-08-22T00:00:00.000Z'
  }
}

function createController(initialDownloads = [download('complete', 'completed', 100, 100)]) {
  const open = ref(true)
  const downloads = ref(initialDownloads)
  const cancelDownload = vi.fn(async (id: string) => [download(id, 'cancelled')])
  const pauseDownload = vi.fn(async (id: string): Promise<BrowserDownloadState[]> => [{ ...download(id), paused: true, canResume: true }])
  const resumeDownload = vi.fn(async (id: string): Promise<BrowserDownloadState[]> => [download(id)])
  const clearFinished = vi.fn(async () => [])
  const showInFolder = vi.fn(async () => undefined)
  const copySavedPath = vi.fn(async (_path: string): Promise<void> => undefined)
  const controller = useDownloadsPanelController({
    open,
    downloads,
    translate: (key, parameters) => {
      if (key === 'downloads.received') return `${parameters?.received} of ${parameters?.total}`
      if (key === 'downloads.downloaded') return `${parameters?.received} downloaded`
      if (key === 'downloads.complete') return `${parameters?.size} · Complete`
      return key
    },
    formatBytes: (bytes) => `${bytes} B`,
    formatPercent: (percent) => `${percent}%`,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    removeFinished: vi.fn(async () => []),
    clearFinished,
    copySavedPath,
    showInFolder
  })
  return { open, downloads, pauseDownload, resumeDownload, cancelDownload, clearFinished, showInFolder, copySavedPath, controller }
}

describe('downloads panel controller', () => {
  it('combines filename and lifecycle filters without treating resumable interruptions as finished', () => {
    const active = download('report-live')
    const resumable = { ...download('report-retry', 'interrupted'), canResume: true }
    const complete = download('report-done', 'completed')
    const cancelled = download('report-cancelled', 'cancelled')
    const interrupted = { ...download('report-failed', 'interrupted'), completedAt: '2026-08-22T00:01:00Z' }
    const h = createController([active, resumable, complete, cancelled, interrupted, download('other')])
    h.controller.query.value = '  REPORT  '
    h.controller.statusFilter.value = 'active'
    expect(h.controller.filteredDownloads.value).toEqual([active, resumable])
    h.controller.statusFilter.value = 'finished'
    expect(h.controller.filteredDownloads.value).toEqual([complete, cancelled, interrupted])
    h.controller.query.value = 'https://'
    expect(h.controller.filteredDownloads.value).toEqual([])
    expect(h.controller.finishedDownloads.value).toEqual([complete, cancelled, interrupted])
    h.controller.dispose()
  })

  it('updates filters with authoritative status changes and resets them on reopen', async () => {
    const h = createController([download('report')])
    h.controller.query.value = 'report'
    h.controller.statusFilter.value = 'active'
    await h.controller.cancel('report')
    expect(h.controller.filteredDownloads.value).toEqual([])
    h.controller.statusFilter.value = 'finished'
    expect(h.controller.filteredDownloads.value).toHaveLength(1)
    h.open.value = false
    h.open.value = true
    expect(h.controller.query.value).toBe('')
    expect(h.controller.statusFilter.value).toBe('all')
    h.controller.dispose()
  })

  it('reports a clear-finished failure without discarding the visible downloads', async () => {
    const { downloads, clearFinished, controller } = createController()
    clearFinished.mockRejectedValueOnce(new Error('Could not clear download history'))

    await controller.clear()

    expect(controller.error.value).toBe('Could not clear download history')
    expect(controller.pendingAction.value).toBeNull()
    expect(downloads.value).toHaveLength(1)
    controller.dispose()
  })

  it('deduplicates actions while one is pending and accepts the authoritative result', async () => {
    let resolveCancel: ((downloads: BrowserDownloadState[]) => void) | undefined
    const pendingCancel = new Promise<BrowserDownloadState[]>((resolve) => {
      resolveCancel = resolve
    })
    const { downloads, cancelDownload, controller } = createController([download('slow')])
    cancelDownload.mockReturnValue(pendingCancel)

    const first = controller.cancel('slow')
    const duplicate = controller.cancel('slow')
    expect(cancelDownload).toHaveBeenCalledTimes(1)
    expect(controller.pendingAction.value).toBe('cancel:slow')

    resolveCancel?.([download('slow', 'cancelled')])
    await Promise.all([first, duplicate])

    expect(downloads.value[0]?.state).toBe('cancelled')
    expect(controller.pendingAction.value).toBeNull()
    controller.dispose()
  })

  it('ignores a pause result after closing the panel and accepts lower progress on resume', async () => {
    const { open, downloads, pauseDownload, resumeDownload, controller } = createController([download('slow')])
    let settle!: (downloads: BrowserDownloadState[]) => void
    pauseDownload.mockReturnValueOnce(new Promise(resolve => { settle = resolve }))
    const pending = controller.pause('slow')
    open.value = false
    open.value = true
    resumeDownload.mockResolvedValueOnce([download('slow', 'progressing', 5, 100)])
    await controller.resume('slow')
    settle([{ ...download('slow'), paused: true }])
    await pending
    expect(downloads.value[0]).toMatchObject({ receivedBytes: 5 })
    expect(downloads.value[0]?.paused).not.toBe(true)
    expect(controller.downloadProgress(downloads.value[0])).toBe(5)
    controller.dispose()
  })

  it('clamps progress and formats determinate, indeterminate, and completed metadata', () => {
    const { controller } = createController()
    const overComplete = download('over', 'progressing', 150, 100)
    const indeterminate = download('unknown', 'progressing', 25, 0)
    const completed = download('done', 'completed', 125, 100)

    expect(controller.downloadProgress(overComplete)).toBe(100)
    expect(controller.downloadProgress(indeterminate)).toBe(0)
    expect(controller.downloadMeta(overComplete)).toBe('100% · 150 B of 100 B')
    expect(controller.downloadMeta(indeterminate)).toBe('25 B downloaded')
    expect(controller.downloadMeta(completed)).toBe('125 B · Complete')
    controller.dispose()
  })
})


describe('Downloads saved-path copying', () => {
  const saved = { ...download('saved', 'completed', 100, 100), savePath: '/tmp/saved report.bin' }

  it.each(['/tmp/saved report.bin', 'C:\\Downloads\\saved report.bin'])('copies the retained path verbatim: %s', async savePath => {
    const entry = { ...saved, savePath }
    const h = createController([entry])
    try {
      await h.controller.copyPath(entry.id)
      expect(h.copySavedPath).toHaveBeenCalledExactlyOnceWith(savePath)
      expect(h.controller.copyFeedback.value).toBe('success')
      expect(h.downloads.value).toEqual([entry])
      expect(h.showInFolder).not.toHaveBeenCalled()
      expect(h.cancelDownload).not.toHaveBeenCalled()
    } finally { h.controller.dispose() }
  })

  it.each([
    { ...saved, state: 'progressing' as const },
    { ...saved, state: 'cancelled' as const },
    { ...saved, state: 'interrupted' as const, canResume: true },
    { ...saved, savePath: undefined },
    { ...saved, savePath: '' }
  ])('does not copy an ineligible record: $state / $savePath', async entry => {
    const h = createController([entry])
    try {
      expect(h.controller.canCopyPath(entry)).toBe(false)
      await h.controller.copyPath(entry.id)
      expect(h.copySavedPath).not.toHaveBeenCalled()
    } finally { h.controller.dispose() }
  })

  it('does not copy hidden or missing records', async () => {
    const h = createController([saved])
    try {
      h.controller.statusFilter.value = 'active'
      await h.controller.copyPath(saved.id)
      h.controller.statusFilter.value = 'all'
      h.controller.query.value = 'missing'
      await h.controller.copyPath(saved.id)
      h.controller.query.value = ''
      await h.controller.copyPath('missing')
      expect(h.copySavedPath).not.toHaveBeenCalled()
    } finally { h.controller.dispose() }
  })

  it('deduplicates pending copies and reports a generic failure before allowing recovery', async () => {
    const h = createController([saved])
    let reject!: (cause: Error) => void
    h.copySavedPath.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    try {
      const copying = h.controller.copyPath(saved.id)
      await h.controller.copyPath(saved.id)
      expect(h.copySavedPath).toHaveBeenCalledTimes(1)
      expect(h.controller.pendingAction.value).toBe(`copy:${saved.id}`)
      reject(new Error('Synthetic clipboard failure with private detail'))
      await copying
      expect(h.controller.copyFeedback.value).toBe('error')
      expect(h.controller.error.value).toBe('')
      expect(h.controller.pendingAction.value).toBeNull()
      await h.controller.copyPath(saved.id)
      expect(h.controller.copyFeedback.value).toBe('success')
    } finally { h.controller.dispose() }
  })

  describe.each(['success', 'failure'] as const)('late clipboard %s', outcome => {
    it.each(['reopen', 'query', 'filter', 'path', 'state', 'remove', 'dispose'] as const)('does not restore feedback after %s', async change => {
      const h = createController([saved])
      let resolve!: () => void
      let reject!: (cause: Error) => void
      h.copySavedPath.mockReturnValueOnce(new Promise<void>((done, fail) => { resolve = done; reject = fail }))
      try {
        const copying = h.controller.copyPath(saved.id)
        if (change === 'reopen') { h.open.value = false; h.open.value = true }
        else if (change === 'query') { h.controller.query.value = 'missing'; h.controller.query.value = '' }
        else if (change === 'filter') { h.controller.statusFilter.value = 'active'; h.controller.statusFilter.value = 'all' }
        else if (change === 'path') { h.downloads.value = [{ ...saved, savePath: '/tmp/replaced.bin' }]; h.downloads.value = [saved] }
        else if (change === 'state') { h.downloads.value = [{ ...saved, state: 'interrupted' }]; h.downloads.value = [saved] }
        else if (change === 'remove') { h.downloads.value = []; h.downloads.value = [saved] }
        else h.controller.dispose()
        if (outcome === 'success') resolve()
        else reject(new Error('Old clipboard failure'))
        await copying
        expect(h.controller.copyFeedback.value).toBe('')
      } finally { h.controller.dispose() }
    })
  })

  it('keeps a newer copy pending when an older panel-session copy finishes', async () => {
    const h = createController([saved])
    let finishOld!: () => void
    let finishNew!: () => void
    h.copySavedPath
      .mockReturnValueOnce(new Promise<void>(resolve => { finishOld = resolve }))
      .mockReturnValueOnce(new Promise<void>(resolve => { finishNew = resolve }))
    try {
      const oldCopy = h.controller.copyPath(saved.id)
      h.open.value = false
      h.open.value = true
      const newCopy = h.controller.copyPath(saved.id)
      finishOld()
      await oldCopy
      expect(h.controller.pendingAction.value).toBe(`copy:${saved.id}`)
      expect(h.controller.copyFeedback.value).toBe('')
      finishNew()
      await newCopy
      expect(h.controller.copyFeedback.value).toBe('success')
      expect(h.controller.pendingAction.value).toBeNull()
    } finally { h.controller.dispose() }
  })
})


describe('Downloads retained origin labels', () => {
  it.each([
    ['https://user:secret@EXAMPLE.test:443/private?token=hidden#fragment', 'https://example.test'],
    ['http://localhost:4312/report', 'http://localhost:4312'],
    ['https://[::1]:8443/report', 'https://[::1]:8443'],
    ['https://bücher.example/report', 'https://xn--bcher-kva.example'],
    ['blob:https://example.test/private', ''],
    ['data:text/plain,private', ''],
    ['file:///private/report.csv', ''],
    ['javascript:alert(1)', ''],
    ['not a URL', '']
  ])('uses only the HTTP(S) origin of %s', (url, expected) => {
    const h = createController()
    try { expect(h.controller.downloadOrigin({ ...download('report'), url })).toBe(expected) }
    finally { h.controller.dispose() }
  })
})
