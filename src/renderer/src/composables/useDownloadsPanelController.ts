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
  clearFinished: () => Promise<BrowserDownloadState[]>
  showInFolder: (downloadId: string) => Promise<void>
}

export function useDownloadsPanelController(options: DownloadsPanelControllerOptions) {
  const error = ref('')
  const pendingAction = ref<string | null>(null)
  const finishedDownloads = computed(() => options.downloads.value.filter((download) => !isActiveDownload(download)))
  let actionGeneration = 0

  function downloadProgress(download: BrowserDownloadState): number {
    if (download.state === 'completed') return 100
    if (download.totalBytes <= 0) return 0
    return Math.min(100, Math.max(0, Math.round(download.receivedBytes / download.totalBytes * 100)))
  }

  function downloadMeta(download: BrowserDownloadState): string {
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

  function clear(): Promise<void> {
    return runAction('clear', options.clearFinished)
  }

  function reveal(downloadId: string): Promise<void> {
    return runAction(`reveal:${downloadId}`, () => options.showInFolder(downloadId))
  }

  const stopOpenTracking = watch(options.open, () => {
    invalidateActions()
    resetError()
  }, { flush: 'sync' })

  function dispose(): void {
    invalidateActions()
    stopOpenTracking()
  }

  return {
    error,
    pendingAction,
    finishedDownloads,
    downloadProgress,
    downloadMeta,
    resetError,
    pause,
    resume,
    cancel,
    clear,
    reveal,
    dispose
  }
}
