import { isActiveDownload } from '../../../shared/download-state.js'
import { computed, ref, watch, type Ref } from 'vue'
import type { BrowserDownloadState } from '../../../shared/types.js'

type Translate = (key: string, parameters?: Record<string, string | number>) => string

export interface DownloadsPanelControllerOptions {
  open: Readonly<Ref<boolean>>
  downloads: Ref<BrowserDownloadState[]>
  translate: Translate
  formatBytes: (bytes: number) => string
  formatPercent: (percent: number) => string
  pauseDownload: (downloadId: string) => Promise<BrowserDownloadState[]>
  resumeDownload: (downloadId: string) => Promise<BrowserDownloadState[]>
  cancelDownload: (downloadId: string) => Promise<BrowserDownloadState[]>
  removeFinished: (downloadId: string) => Promise<BrowserDownloadState[]>
  clearFinished: () => Promise<BrowserDownloadState[]>
  showInFolder: (downloadId: string) => Promise<void>
  copySavedPath: (path: string) => Promise<void>
}

export function useDownloadsPanelController(options: DownloadsPanelControllerOptions) {
  const query = ref('')
  const statusFilter = ref<'all' | 'active' | 'finished' | 'completed' | 'cancelled' | 'interrupted'>('all')
  const filteredDownloads = computed(() => {
    const filename = query.value.trim().toLocaleLowerCase()
    return options.downloads.value.filter(download => {
      if (filename && !download.filename.toLocaleLowerCase().includes(filename)) return false
      if (statusFilter.value === 'all') return true
      if (statusFilter.value === 'active') return isActiveDownload(download)
      if (statusFilter.value === 'finished') return !isActiveDownload(download)
      return download.state === statusFilter.value
    })
  })
  const error = ref('')
  const copyFeedback = ref<'success' | 'error' | ''>('')
  const copiedDownload = ref<{ id: string; path: string } | null>(null)
  let copyGeneration = 0
  const pendingAction = ref<string | null>(null)
  const finishedDownloads = computed(() => options.downloads.value.filter((download) => !isActiveDownload(download)))
  let actionGeneration = 0

  function canCopyPath(download: BrowserDownloadState): boolean {
    return download.state === 'completed' && typeof download.savePath === 'string' && download.savePath.length > 0
  }

  function resetCopyFeedback(): void {
    copyGeneration += 1
    copyFeedback.value = ''
  }

  const copyTargetVisible = computed(() => !copiedDownload.value || filteredDownloads.value.some(
    download => download.id === copiedDownload.value!.id
      && download.savePath === copiedDownload.value!.path && canCopyPath(download)
  ))
  const stopCopyTracking = watch([query, statusFilter, options.open, copyTargetVisible], resetCopyFeedback, { flush: 'sync' })

  async function copyPath(downloadId: string): Promise<void> {
    if (!options.open.value || pendingAction.value) return
    const download = filteredDownloads.value.find(entry => entry.id === downloadId)
    const path = download?.savePath
    if (!download || !canCopyPath(download) || !path) return
    resetCopyFeedback()
    copiedDownload.value = { id: download.id, path }
    await runAction(`copy:${download.id}`, async () => {
      const generation = copyGeneration
      try {
        await options.copySavedPath(path)
        if (generation === copyGeneration) copyFeedback.value = 'success'
      } catch {
        if (generation === copyGeneration) copyFeedback.value = 'error'
      }
    })
  }

  function downloadOrigin(download: BrowserDownloadState): string {
    try {
      const url = new URL(download.url)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : ''
    } catch { return '' }
  }

  function downloadProgress(download: BrowserDownloadState): number {
    if (download.state === 'completed') return 100
    if (download.totalBytes <= 0) return 0
    return Math.min(100, Math.max(0, Math.round(download.receivedBytes / download.totalBytes * 100)))
  }

  function downloadMeta(download: BrowserDownloadState): string {
    if (download.failureReason === 'destination-unavailable') return options.translate('downloads.destinationUnavailable')
    if (download.state === 'progressing') {
      const received = options.formatBytes(download.receivedBytes)
      const progress = download.totalBytes > 0
        ? `${options.formatPercent(downloadProgress(download))} · ${options.translate('downloads.received', { received, total: options.formatBytes(download.totalBytes) })}`
        : options.translate('downloads.downloaded', { received })
      return download.paused ? `${options.translate('downloads.paused')} · ${progress}` : progress
    }
    if (download.state === 'completed') return options.translate('downloads.complete', { size: options.formatBytes(download.receivedBytes) })
    if (download.state === 'cancelled') return options.translate('downloads.cancelled')
    return options.translate('downloads.interrupted')
  }

  function resetError(): void {
    error.value = ''
  }

  function invalidateActions(): void {
    actionGeneration += 1
    pendingAction.value = null
  }

  async function runAction(
    actionId: string,
    operation: () => Promise<BrowserDownloadState[] | void>
  ): Promise<void> {
    if (pendingAction.value) return
    const generation = ++actionGeneration
    resetError()
    pendingAction.value = actionId
    try {
      const nextDownloads = await operation()
      if (generation !== actionGeneration) return
      if (nextDownloads) options.downloads.value = nextDownloads
    } catch (cause) {
      if (generation !== actionGeneration) return
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (generation === actionGeneration) pendingAction.value = null
    }
  }

  function pause(downloadId: string): Promise<void> {
    return runAction(`pause:${downloadId}`, () => options.pauseDownload(downloadId))
  }

  function resume(downloadId: string): Promise<void> {
    return runAction(`resume:${downloadId}`, () => options.resumeDownload(downloadId))
  }

  function cancel(downloadId: string): Promise<void> {
    return runAction(`cancel:${downloadId}`, () => options.cancelDownload(downloadId))
  }

  function remove(downloadId: string): Promise<void> {
    return runAction(`remove:${downloadId}`, () => options.removeFinished(downloadId))
  }

  function clear(): Promise<void> {
    return runAction('clear', options.clearFinished)
  }

  function reveal(downloadId: string): Promise<void> {
    return runAction(`reveal:${downloadId}`, () => options.showInFolder(downloadId))
  }

  const stopOpenTracking = watch(options.open, () => {
    invalidateActions()
    resetError()
    query.value = ''
    statusFilter.value = 'all'
  }, { flush: 'sync' })

  function dispose(): void {
    invalidateActions()
    resetCopyFeedback()
    stopCopyTracking()
    stopOpenTracking()
  }

  return {
    query,
    statusFilter,
    filteredDownloads,
    error,
    copyFeedback,
    copyPath,
    canCopyPath,
    pendingAction,
    finishedDownloads,
    downloadOrigin,
    downloadProgress,
    downloadMeta,
    resetError,
    pause,
    resume,
    cancel,
    remove,
    clear,
    reveal,
    dispose
  }
}
