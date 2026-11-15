import type { BrowserWindow } from 'electron'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import type { BrowserDownloadState } from '../shared/types.js'
import type { AppQuitState } from './app-lifecycle.js'
import type { TrustedDialogOptions } from './trusted-dialogs/trusted-dialogs.js'

export interface QuitWithDownloadsHost {
  /** Every download Hronaut lists, read when a quit is requested. */
  downloads(): readonly BrowserDownloadState[]
  /** The main window, which the question is asked in while it is open. */
  window(): BrowserWindow | undefined
  /** Restores, shows and focuses the main window, so a question asked there is seen. */
  showWindow(): void
  /** Asks in Hronaut's own dialog over the given window's pages, or in the system dialog, with no window for `null`. */
  showDialog(options: TrustedDialogOptions<BrowserWindow>): Promise<{ response: number }>
  text(key: MessageKey, parameters?: MessageParameters): string
}

/** What cancels the downloads: Quit, or Restart in Settings, which quits first. */
export type QuitPurpose = 'quit' | 'restart'

/**
 * Asks before Hronaut's own Quit, in its menu or tray, or closing its window, cancels downloads in progress, as
 * Chrome does, and so does Restart, in its own words. Quitting deletes their unfinished files, and nothing can resume
 * them once Hronaut starts again. Keep downloading is the default answer. A second request while the question is open
 * waits for the same answer; one for the other purpose, such as Quit while Restart asks, gets no, since the question
 * the person answers is not about it. Resolves whether to go on.
 */
export function createQuitWithDownloadsConfirmation(host: QuitWithDownloadsHost): (purpose?: QuitPurpose) => Promise<boolean> {
  let pending: Promise<boolean> | undefined
  let pendingPurpose: QuitPurpose = 'quit'
  /** Whether the open question is in the main window rather than in a system dialog of its own. */
  let askedInWindow = false
  // A question that cannot be shown must not leave Hronaut impossible to quit.
  const quitAnyway = (error: unknown): boolean => {
    console.error('[quit] Could not ask about downloads in progress:', error)
    return true
  }
  return (purpose = 'quit') => {
    if (pending) {
      // The window may have been hidden or minimized since it asked; bring the question back where it waits.
      if (askedInWindow) {
        try {
          host.showWindow()
        } catch (error) {
          console.error('[quit] Could not show the question about downloads in progress:', error)
        }
      }
      return purpose === pendingPurpose ? pending : Promise.resolve(false)
    }
    let count: number
    let options: TrustedDialogOptions<BrowserWindow>
    try {
      // A paused download is still in progress; an interrupted one has already stopped.
      count = host.downloads().filter((download) => download.state === 'progressing').length
      if (count === 0) return Promise.resolve(true)
      const window = host.window()
      // Quit from the tray or the menu can come while the window is behind other apps, minimized or hidden in the
      // tray, so it comes forward to ask; only without a window does the system dialog ask on its own.
      const open = window && !window.isDestroyed() ? window : null
      if (open) host.showWindow()
      askedInWindow = open !== null
      const restart = purpose === 'restart'
      options = {
        type: 'warning',
        title: host.text(restart ? 'native.dialog.restartDownloadsTitle' : 'native.dialog.quitDownloadsTitle'),
        message: host.text('native.dialog.quitDownloadsMessage', { count }),
        // Chosen by the count itself: languages such as Russian count 21 like 1 but cannot say "its file" for it.
        detail: host.text(restart
          ? count === 1 ? 'native.dialog.restartDownloadDetail' : 'native.dialog.restartDownloadsDetail'
          : count === 1 ? 'native.dialog.quitDownloadDetail' : 'native.dialog.quitDownloadsDetail'),
        buttons: [
          host.text('native.dialog.quitDownloadsKeep'),
          host.text(restart ? 'native.dialog.restartDownloadsRestart' : 'native.dialog.quitDownloadsQuit')
        ],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        variant: { kind: 'message', topic: 'downloads' },
        window: open
      }
    } catch (error) {
      return Promise.resolve(quitAnyway(error))
    }
    try {
      pendingPurpose = purpose
      pending = host.showDialog(options)
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
