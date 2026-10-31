import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserJavaScriptDialog } from '../../shared/types.js'
import { PrintDialogOpenError } from '../browser/print-dialog-guard.js'
import { WebsiteDialogOpenError } from '../browser/website-dialog-guard.js'
import { textResult } from './tool-results.js'

// A website's alert or confirm holds its page until someone answers it, and the page answers no command meanwhile.

/** The call's result, noting that its tab now shows a website dialog, such as one the call's own input opened. */
export function withWebsiteDialogNote(result: CallToolResult, dialog: BrowserJavaScriptDialog | undefined): CallToolResult {
  if (!dialog) return result
  const note = `The page now shows a website ${dialog.type}: ${JSON.stringify(dialog.message)}. `
    + 'It answers nothing else until the dialog is answered; answer it with browser_dialog.'
  return { ...result, content: [...result.content, { type: 'text', text: note }] }
}

/** Whether a page's print dialog or its website's alert or confirm stopped a call after the call reached the page. */
export function pageDialogInterrupted(error: unknown): error is WebsiteDialogOpenError | PrintDialogOpenError {
  return (error instanceof WebsiteDialogOpenError || error instanceof PrintDialogOpenError) && error.sent
}

/**
 * The result of an agent's action that a page's dialog stopped after the action reached the page. The dialog now
 * holds the page, and what the action started goes on once it closes, so the action's effects are unknown and it must
 * not be repeated blindly.
 */
export function pageDialogInterruptedResult(error: WebsiteDialogOpenError | PrintDialogOpenError, reviewFinalizationFailed = false): CallToolResult {
  const website = error instanceof WebsiteDialogOpenError
  const outcome = {
    status: 'OUTCOME_UNKNOWN', reason: website ? 'WEBSITE_DIALOG_OPENED' : 'PRINT_DIALOG_OPENED',
    dispatch: 'dispatched', effects: 'possible', retrySafe: false, detail: error.message,
    ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
    nextAction: (website ? 'Answer the dialog with browser_dialog; the action then goes on. ' : 'Ask the person to print or cancel. ')
      + 'Inspect fresh page state before continuing; do not repeat the action blindly.'
  }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}
