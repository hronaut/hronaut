import { computed, ref, type Ref } from 'vue'
import type { BrowserDownloadState } from '../../../shared/types.js'

type Translate = (key: string, parameters?: Record<string, string | number>) => string

export interface DownloadsPanelControllerOptions {
  downloads: Ref<BrowserDownloadState[]>
  translate: Translate
  formatBytes: (bytes: number) => string
  formatPercent: (percent: number) => string
  cancelDownload: (downloadId: string) => Promise<BrowserDownloadState[]>
  clearFinished: () => Promise<BrowserDownloadState[]>
  showInFolder: (downloadId: string) => Promise<void>
}

export function useDownloadsPanelController(options: DownloadsPanelControllerOptions) {
  const error = ref('')
  const pendingAction = ref<string | null>(null)
  const finishedDownloads = computed(() => options.downloads.value.filter((download) => download.state !== 'progressing'))

  function downloadProgress(download: BrowserDownloadState): number {
    if (download.state === 'completed') return 100
    if (download.totalBytes <= 0) return 0
    return Math.min(100, Math.max(0, Math.round(download.receivedBytes / download.totalBytes * 100)))
  }

  function downloadMeta(download: BrowserDownloadState): string {
    if (download.state === 'progressing') {
      const received = options.formatBytes(download.receivedBytes)
      return download.totalBytes > 0
        ? `${options.formatPercent(downloadProgress(download))} · ${options.translate('downloads.received', { received, total: options.formatBytes(download.totalBytes) })}`
        : options.translate('downloads.downloaded', { received })
    }
    if (download.state === 'completed') return options.translate('downloads.complete', { size: options.formatBytes(download.receivedBytes) })
    if (download.state === 'cancelled') return options.translate('downloads.cancelled')
    return options.translate('downloads.interrupted')
  }

  function resetError(): void {
    error.value = ''
  }

  async function runAction(
    actionId: string,
    operation: () => Promise<BrowserDownloadState[] | void>
  ): Promise<void> {
    if (pendingAction.value) return
    resetError()
    pendingAction.value = actionId
    try {
      const nextDownloads = await operation()
      if (nextDownloads) options.downloads.value = nextDownloads
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (pendingAction.value === actionId) pendingAction.value = null
    }
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

  return {
    error,
    pendingAction,
    finishedDownloads,
    downloadProgress,
    downloadMeta,
    resetError,
    cancel,
    clear,
    reveal
  }
}
