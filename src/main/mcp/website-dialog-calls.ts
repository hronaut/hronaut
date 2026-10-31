import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserJavaScriptDialog } from '../../shared/types.js'

// A website's alert or confirm holds its page until someone answers it, and the page answers no command meanwhile.

/** The call's result, noting that its tab now shows a website dialog, such as one the call's own input opened. */
export function withWebsiteDialogNote(result: CallToolResult, dialog: BrowserJavaScriptDialog | undefined): CallToolResult {
  if (!dialog) return result
  const note = `The page now shows a website ${dialog.type}: ${JSON.stringify(dialog.message)}. `
    + 'It answers nothing else until the dialog is answered; answer it with browser_dialog.'
  return { ...result, content: [...result.content, { type: 'text', text: note }] }
}
