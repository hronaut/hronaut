import type { BrowserShortcutAction } from '../../../shared/browser-shortcuts.js'
import type {
  BrowserActionFailure,
  HronautApi,
  HronautCredentialsApi,
  HronautPermissionsApi,
  HronautUpdatesApi,
  CredentialSummary,
  HelpMenuAction,
  SitePermissionEntry
} from '../../../shared/types.js'
import { disposeAll } from './dispose-all.js'

interface ShellEventsApi {
  onHelpRequested(listener: (action: HelpMenuAction) => void): () => void
  onClipboardFailed(listener: (message: string) => void): () => void
  onActionFailed(listener: (failure: BrowserActionFailure) => void): () => void
}

export interface AppEventsControllerOptions {
  browserApi: Pick<
    HronautApi,
    'onUserAttentionRequested' | 'onShortcutRequested' | 'onTabGroupEditRequested'
  >
  permissionsApi: Pick<HronautPermissionsApi, 'onChanged'>
  credentialsApi: Pick<HronautCredentialsApi, 'onChanged'>
  updatesApi: Pick<HronautUpdatesApi, 'onOpenRequested'>
  shellApi: ShellEventsApi
  onUserAttention: () => unknown
  onShortcut: (action: BrowserShortcutAction) => unknown
  onTabGroupEdit: (groupId: string) => unknown
  onPermissionsChanged: (permissions: SitePermissionEntry[]) => unknown
  onCredentialsChanged: (credentials: CredentialSummary[]) => unknown
  onUpdateOpen: () => unknown
  onHelp: (action: HelpMenuAction) => unknown
  onClipboardFailure: (message: string) => unknown
  onActionFailure: (failure: BrowserActionFailure) => unknown
  onError: (error: unknown) => void
}

export function useAppEventsController(options: AppEventsControllerOptions) {
  let disposed = false

  function reportError(error: unknown): void {
    if (!disposed) options.onError(error)
  }

  const active = <Arguments extends unknown[]>(callback: (...args: Arguments) => unknown) => (
    (...args: Arguments): void => {
      if (disposed) return
      try {
        void Promise.resolve(callback(...args)).catch(reportError)
      } catch (error) {
        reportError(error)
      }
    }
  )

  const unsubscribers = [
    options.browserApi.onUserAttentionRequested(active(options.onUserAttention)),
    options.browserApi.onShortcutRequested(active(options.onShortcut)),
    options.browserApi.onTabGroupEditRequested(active(options.onTabGroupEdit)),
    options.permissionsApi.onChanged(active(options.onPermissionsChanged)),
    options.credentialsApi.onChanged(active(options.onCredentialsChanged)),
    options.updatesApi.onOpenRequested(active(options.onUpdateOpen)),
    options.shellApi.onHelpRequested(active(options.onHelp)),
    options.shellApi.onClipboardFailed(active(options.onClipboardFailure)),
    options.shellApi.onActionFailed(active(options.onActionFailure))
  ]

  function dispose(): void {
    if (disposed) return
    disposed = true
    disposeAll(unsubscribers)
  }

  return { dispose }
}

export type AppEventsController = ReturnType<typeof useAppEventsController>
