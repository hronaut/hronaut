/** What `[main] Uncaught exception:` lines start with, which the e2e fixtures read from the app's error output. */
export const UNCAUGHT_EXCEPTION_LOG_PREFIX = '[main] Uncaught exception:'
/** What `[main] Unhandled rejection:` lines start with, which the e2e fixtures read from the app's error output too. */
export const UNHANDLED_REJECTION_LOG_PREFIX = '[main] Unhandled rejection:'

interface UncaughtExceptionSource {
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown
}

interface UnhandledRejectionSource {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown
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

/**
 * Logs a promise rejected in the main process that nothing handled, with its reason, and carries on, as Electron does
 * on its own. Electron's own warning reads like any other of Node's and leaves only an exit code behind, so a broken
 * step in main, such as a save dialog's folder that failed to load as the browser was built, went unseen; under its
 * own line the e2e fixtures fail the test that caused it, as they do an uncaught exception.
 */
export function logUnhandledRejections(
  source: UnhandledRejectionSource = process,
  log: (...data: unknown[]) => void = console.error
): void {
  source.on('unhandledRejection', (reason) => {
    log(UNHANDLED_REJECTION_LOG_PREFIX, reason)
  })
}
