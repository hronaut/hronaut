import type { Browser } from './browser.js'

export async function runBackgroundAction(
  action: string,
  callback: () => unknown,
  onFailure: (action: string, error: unknown) => void
): Promise<void> {
  try {
    await callback()
  } catch (error) {
    try {
      onFailure(action, error)
    } catch {
      // Background work has no caller to receive a second reporting failure.
      // The owning reporter is responsible for logging before notifying UI.
    }
  }
}

/** Runs a wallet step a tab's lifecycle starts in the background, logging and reporting a failure. */
export function runWalletLifecycleAction(browser: Browser, action: string, callback: () => unknown): void {
  void runBackgroundAction(action, callback, (failedAction, error) => {
    console.error(`[wallet] Could not ${failedAction}:`, error)
    browser.options.onActionFailed?.(failedAction, error)
  })
}
