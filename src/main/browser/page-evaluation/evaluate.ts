import type { BrowserDialogHandlingOptions } from '../../../shared/types.js'
import { dialogAwareEvaluateScript } from '../page-scripts.js'
import type { PageEvaluationAccess, PageEvaluationTab } from './page-evaluation-access.js'

/**
 * Runs a script in the tab's page and returns its value. A foreground page,
 * or one whose DevTools are open, evaluates it directly; otherwise it runs
 * through the debugger with the page's dialogs dismissed or accepted as asked.
 * Hronaut never takes focus for it.
 */
export async function evaluate<Tab extends PageEvaluationTab>(access: PageEvaluationAccess<Tab>, script: string, tabId?: string, dialog: BrowserDialogHandlingOptions = {}): Promise<unknown> {
  const webContents = access.getTab(tabId).webContents
  if (dialog.promptText !== undefined) throw new Error('Text prompts are supported by browser_click; Electron does not implement prompt() evaluation')
  // Preserve foreground native-dialog behavior, but never let a background
  // evaluation activate Hronaut. Unexpected background dialogs are dismissed
  // inside the page wrapper; explicit dialogAction still wins.
  if (dialog.dialogAction === undefined && access.isWindowFocused()) {
    return access.withBackgroundAgentFocusGuard(() => webContents.executeJavaScript(script, true))
  }
  // DevTools owns Chromium's debugger session. Keep direct evaluation
  // available there while the native non-focusable guard blocks activation.
  if (dialog.dialogAction === undefined && (
    access.isDevToolsOpening(webContents.id) || webContents.isDevToolsOpened()
  )) {
    return access.withBackgroundAgentFocusGuard(() => webContents.executeJavaScript(script, true))
  }
  const dialogAction = dialog.dialogAction ?? 'dismiss'
  return access.withBackgroundAgentFocusGuard(() => access.withDebugger(webContents, async () => (
    access.evaluateWithAttachedDebugger(
      webContents,
      dialogAwareEvaluateScript(script, dialogAction),
      await access.mainWorldContextId(webContents)
    )
  )))
}
