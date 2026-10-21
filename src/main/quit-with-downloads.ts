import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import type { BrowserDownloadState } from '../shared/types.js'
import type { AppQuitState } from './app-lifecycle.js'

export interface QuitWithDownloadsHost {
  /** Every download Hronaut lists, read when a quit is requested. */
  downloads(): readonly BrowserDownloadState[]
  /** The main window, which the question is attached to while it is shown. */
  window(): BrowserWindow | undefined
  showMessageBox(window: BrowserWindow | undefined, options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  text(key: MessageKey, parameters?: MessageParameters): string
}

/**
 * Asks before Hronaut's own Quit, in its menu or tray, or closing its window, cancels downloads in progress, as
 * Chrome does. Quitting deletes their unfinished files, and nothing can resume them once Hronaut starts again. Keep
 * downloading is the default answer. A second request while the question is open waits for the same answer.
 * Resolves whether to quit.
 */
export function createQuitWithDownloadsConfirmation(host: QuitWithDownloadsHost): () => Promise<boolean> {
  let pending: Promise<boolean> | undefined
  // A question that cannot be shown must not leave Hronaut impossible to quit.
  const quitAnyway = (error: unknown): boolean => {
    console.error('[quit] Could not ask about downloads in progress:', error)
    return true
  }
  return () => {
    if (pending) return pending
    let count: number
    let options: MessageBoxOptions
    let parent: BrowserWindow | undefined
    try {
      // A paused download is still in progress; an interrupted one has already stopped.
      count = host.downloads().filter((download) => download.state === 'progressing').length
      if (count === 0) return Promise.resolve(true)
      const window = host.window()
      // A sheet on a window hidden in the tray or minimized would not be seen.
      parent = window && !window.isDestroyed() && window.isVisible() && !window.isMinimized() ? window : undefined
      options = {
        type: 'warning',
        title: host.text('native.dialog.quitDownloadsTitle'),
        message: host.text('native.dialog.quitDownloadsMessage', { count }),
        // Chosen by the count itself: languages such as Russian count 21 like 1 but cannot say "its file" for it.
        detail: host.text(count === 1 ? 'native.dialog.quitDownloadDetail' : 'native.dialog.quitDownloadsDetail'),
        buttons: [host.text('native.dialog.quitDownloadsKeep'), host.text('native.dialog.quitDownloadsQuit')],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      }
    } catch (error) {
      return Promise.resolve(quitAnyway(error))
    }
    try {
      pending = host.showMessageBox(parent, options)
        .then(({ response }) => response === 1, quitAnyway)
        .finally(() => { pending = undefined })
    } catch (error) {
      return Promise.resolve(quitAnyway(error))
    }
    return pending
  }
}

/**
 * Quits from Hronaut's menu, its tray or the window's Close once `confirm` agrees, outside the event that asked, since
 * quitting closes the window again. The quit state is set first, so that close passes and nothing asks twice.
 */
export function createQuitRequest(confirm: () => Promise<boolean>, quitState: AppQuitState, quit: () => void): () => void {
  return () => {
    void confirm().then((confirmed) => {
      if (!confirmed) return
      quitState.quitting = true
      setImmediate(quit)
    })
  }
}
