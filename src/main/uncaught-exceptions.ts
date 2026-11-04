/** What `[main] Uncaught exception:` lines start with, which the e2e fixtures read from the app's error output. */
export const UNCAUGHT_EXCEPTION_LOG_PREFIX = '[main] Uncaught exception:'
/** What `[main] Unhandled rejection:` lines start with, which the e2e fixtures read from the app's error output too. */
export const UNHANDLED_REJECTION_LOG_PREFIX = '[main] Unhandled rejection:'

interface MainProcessErrorSource {
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown
}

/**
 * Logs the errors nothing in the main process caught, and carries on.
 *
 * An uncaught exception would freeze Hronaut: Electron's own handler shows it in a native error box, a modal that blocks
 * the main process, and with it every window, page and agent connection, until someone dismisses it: for good while the
 * window is hidden in the tray or nobody is at the screen. Electron leaves the box out once the app handles the event
 * itself, so Hronaut logs the error instead and carries on, as Electron does after the box is dismissed.
 *
 * A promise rejected with nothing to handle it left only Node's warning, which reads like any other of Node's, and exit
 * code 1, so a broken step in main, such as a save dialog's folder that failed to load as the browser was built, went
 * unseen. Handling the event turns both off; under its own line the e2e fixtures fail the test that caused it, as they
 * do over an uncaught exception.
 */
export function logMainProcessErrors(
  source: MainProcessErrorSource = process,
  log: (...data: unknown[]) => void = console.error
): void {
  source.on('uncaughtException', (error) => {
    log(UNCAUGHT_EXCEPTION_LOG_PREFIX, error)
  })
  source.on('unhandledRejection', (reason) => {
    log(UNHANDLED_REJECTION_LOG_PREFIX, reason)
  })
}
