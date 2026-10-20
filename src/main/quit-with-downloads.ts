import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import type { BrowserDownloadState } from '../shared/types.js'

export interface QuitWithDownloadsHost {
  /** Every download Hronaut lists, read when a quit is requested. */
  downloads(): readonly BrowserDownloadState[]
  /** The main window, which the question is attached to while it is shown. */
  window(): BrowserWindow | undefined
  showMessageBox(window: BrowserWindow | undefined, options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  text(key: MessageKey, parameters?: MessageParameters): string
}

/**
 * Asks before a Quit from Hronaut's menu or tray, or closing its window, cancels downloads in progress, as Chrome
 * does. Quitting deletes their unfinished files, and nothing can resume them once Hronaut starts again. Keep
 * downloading is the default answer. A second request while the question is open waits for the same answer.
 * Resolves whether to quit.
 */
export function createQuitWithDownloadsConfirmation(host: QuitWithDownloadsHost): () => Promise<boolean> {
  let pending: Promise<boolean> | undefined
  return () => {
    if (pending) return pending
    // A paused download is still in progress; an interrupted one has already stopped.
    const count = host.downloads().filter((download) => download.state === 'progressing').length
    if (count === 0) return Promise.resolve(true)
    const window = host.window()
    // A sheet on a window hidden in the tray would never be seen.
    const parent = window && !window.isDestroyed() && window.isVisible() ? window : undefined
    pending = host.showMessageBox(parent, {
      type: 'warning',
      title: host.text('native.dialog.quitDownloadsTitle'),
      message: host.text('native.dialog.quitDownloadsMessage', { count }),
      detail: host.text('native.dialog.quitDownloadsDetail', { count }),
      buttons: [host.text('native.dialog.quitDownloadsKeep'), host.text('native.dialog.quitDownloadsQuit')],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then(({ response }) => response === 1, (error: unknown) => {
      // A question that cannot be shown must not leave Hronaut impossible to quit.
      console.error('[quit] Could not ask about downloads in progress:', error)
      return true
    }).finally(() => { pending = undefined })
    return pending
  }
}
