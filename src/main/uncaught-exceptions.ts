/** What `[main] Uncaught exception:` lines start with, which the e2e fixtures read from the app's error output. */
export const UNCAUGHT_EXCEPTION_LOG_PREFIX = '[main] Uncaught exception:'

interface UncaughtExceptionSource {
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown
}

/**
 * Keeps an uncaught exception in the main process from freezing Hronaut. Electron's own handler shows it in a native
 * error box, a modal that blocks the main process, and with it every window, page and agent connection, until someone
 * dismisses it: for good while the window is hidden in the tray or nobody is at the screen. Electron leaves the box
 * out once the app handles the event itself, so Hronaut logs the error instead and carries on, as Electron does after
 * the box is dismissed.
 */
export function logUncaughtExceptions(
  source: UncaughtExceptionSource = process,
  log: (...data: unknown[]) => void = console.error
): void {
  source.on('uncaughtException', (error) => {
    log(UNCAUGHT_EXCEPTION_LOG_PREFIX, error)
  })
}
