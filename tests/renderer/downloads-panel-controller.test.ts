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
  const downloads = ref(initialDownloads)
  const cancelDownload = vi.fn(async (id: string) => [download(id, 'cancelled')])
  const clearFinished = vi.fn(async () => [])
  const showInFolder = vi.fn(async () => undefined)
  const controller = useDownloadsPanelController({
    downloads,
    translate: (key, parameters) => {
      if (key === 'downloads.received') return `${parameters?.received} of ${parameters?.total}`
      if (key === 'downloads.downloaded') return `${parameters?.received} downloaded`
      if (key === 'downloads.complete') return `${parameters?.size} · Complete`
      return key
    },
    formatBytes: (bytes) => `${bytes} B`,
    formatPercent: (percent) => `${percent}%`,
    cancelDownload,
    clearFinished,
    showInFolder
  })
  return { downloads, cancelDownload, clearFinished, showInFolder, controller }
}

describe('downloads panel controller', () => {
  it('reports a clear-finished failure without discarding the visible downloads', async () => {
    const { downloads, clearFinished, controller } = createController()
    clearFinished.mockRejectedValueOnce(new Error('Could not clear download history'))

    await controller.clear()

    expect(controller.error.value).toBe('Could not clear download history')
    expect(controller.pendingAction.value).toBeNull()
    expect(downloads.value).toHaveLength(1)
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
  })
})
