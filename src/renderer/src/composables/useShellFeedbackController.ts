import type { BrowserShortcutAction } from '../../../shared/browser-shortcuts.js'
import type { BrowserActionFailure, BrowserTabGroupState } from '../../../shared/types.js'
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
  translate: (key: string, parameters?: Record<string, unknown>) => string
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

  function reportSplitViewError(error: unknown, fallback: string): void {
    options.showToast(
      'error',
      options.translate('runtime.workspace.splitFailed'),
      friendlyUiError(error, fallback)
    )
  }

  function reportWorkspaceError(workspace: BrowserTabGroupState, error: unknown): void {
    options.showToast(
      'error',
      options.translate('runtime.workspace.newTabFailed'),
      friendlyUiError(
        error,
        options.translate('runtime.workspace.newTabDescription', { workspace: workspace.name })
      )
    )
  }

  function reportShortcutError(_action: BrowserShortcutAction, error: unknown): void {
    reportActionError(error)
  }

  function reportClipboardFailure(message: string): void {
    options.showToast(
      'error',
      options.translate('runtime.capture.copyFailed'),
      friendlyUiError(message, options.translate('runtime.capture.clipboardFailed'))
    )
  }

  function reportBrowserActionFailure({ action, message }: BrowserActionFailure): void {
    const title = action === 'reload'
      ? options.translate('runtimeActions.actionFailure.reload')
      : action === 'save link'
        ? options.translate('runtimeActions.actionFailure.saveLink')
        : options.translate('runtimeActions.actionFailure.generic')
    options.showToast(
      'error',
      title,
      friendlyUiError(message, options.translate('runtime.toast.actionFailed'))
    )
  }

  return {
    reportActionError,
    reportStartupFailure,
    reportSearchError,
    copyText,
    reportSettingError,
    reportSplitViewError,
    reportWorkspaceError,
    reportShortcutError,
    reportClipboardFailure,
    reportBrowserActionFailure
  }
}

export type ShellFeedbackController = ReturnType<typeof useShellFeedbackController>
