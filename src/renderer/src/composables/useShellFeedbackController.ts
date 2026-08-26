import type { AppToastTone } from './useAppToastController.js'
import { friendlyUiError } from './useAppToastController.js'

interface ShellFeedbackBrowserApi {
  copyText(text: string): Promise<void>
}

interface ShellFeedbackFailure {
  error: unknown
}

export interface ShellFeedbackControllerOptions {
  browser: ShellFeedbackBrowserApi
  translate: (key: string) => string
  showToast: (tone: AppToastTone, title: string, message: string) => void
}

export function useShellFeedbackController(options: ShellFeedbackControllerOptions) {
  function reportActionError(error: unknown): void {
    options.showToast(
      'error',
      options.translate('runtimeDetails.browserAction'),
      friendlyUiError(error, options.translate('runtime.toast.actionFailed'))
    )
  }

  function reportStartupFailure(failures: readonly ShellFeedbackFailure[]): void {
    options.showToast(
      'error',
      options.translate('runtime.toast.startupIncomplete'),
      friendlyUiError(
        failures[0]?.error,
        options.translate('runtime.toast.startupIncompleteDescription')
      )
    )
  }

  function reportSearchError(title: string, message: string): void {
    options.showToast('error', title, message)
  }

  async function copyText(text: string): Promise<boolean> {
    try {
      await options.browser.copyText(text)
      return true
    } catch (error) {
      options.showToast(
        'error',
        options.translate('runtime.capture.copyFailed'),
        friendlyUiError(error, options.translate('runtime.capture.clipboardFailed'))
      )
      return false
    }
  }

  function reportSettingError(error: unknown): void {
    options.showToast(
      'error',
      options.translate('runtime.toast.settingNotSaved'),
      friendlyUiError(error, options.translate('runtime.toast.settingKept'))
    )
  }

  return {
    reportActionError,
    reportStartupFailure,
    reportSearchError,
    copyText,
    reportSettingError
  }
}

export type ShellFeedbackController = ReturnType<typeof useShellFeedbackController>
