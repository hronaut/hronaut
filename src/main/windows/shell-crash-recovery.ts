import type { BrowserWindow } from 'electron'

/** How long, in milliseconds, Hronaut waits before it loads its window's page again after the page's process exits. */
export const SHELL_RELOAD_FIRST_DELAY_MS = 500
/** The longest wait between loads while the page keeps exiting: each exit doubles the wait up to it. */
export const SHELL_RELOAD_MAX_DELAY_MS = 30_000
/** A page that stayed up this long, in milliseconds, after it loaded starts the waits from the first again. */
export const SHELL_RELOAD_STABLE_MS = 60_000

/**
 * Loads the main window's own page again when its process exits other than cleanly, as by a crash or running out of
 * memory, which left the window blank until the person quit. The page reads the browser's state again as it loads.
 * Each exit soon after a load doubles the wait before the next, so a page that crashes as it starts does not spin;
 * nothing is loaded once Hronaut quits or the window closes.
 */
export function reloadShellAfterRendererExit(window: BrowserWindow, quitting: () => boolean): void {
  const contents = window.webContents
  let delay = SHELL_RELOAD_FIRST_DELAY_MS
  let loadedAt: number | undefined
  let timer: NodeJS.Timeout | undefined
  contents.on('did-finish-load', () => { loadedAt = performance.now() })
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || quitting() || window.isDestroyed()) return
    if (loadedAt !== undefined && performance.now() - loadedAt >= SHELL_RELOAD_STABLE_MS) delay = SHELL_RELOAD_FIRST_DELAY_MS
    loadedAt = undefined
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (quitting() || window.isDestroyed() || contents.isDestroyed()) return
      contents.reload()
    }, delay)
    delay = Math.min(delay * 2, SHELL_RELOAD_MAX_DELAY_MS)
  })
  window.once('closed', () => clearTimeout(timer))
}
