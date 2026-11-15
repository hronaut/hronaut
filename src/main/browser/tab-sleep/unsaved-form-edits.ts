import type { WebFrameMain } from 'electron'
import { pageScript } from '../../../shared/page-script.js'
import type { BrowserTab } from '../browser-tab.js'
import { watchFormEditsInPage } from './unsaved-form-edits.page.js'

/** Records in a document whether the person edits editable content, which forms do not show, inside shadow roots too. */
const WATCH_FORM_EDITS_SCRIPT = pageScript(watchFormEditsInPage)

/**
 * Starts recording in the page, or in one of its frames once it loads, whether the person edits editable content,
 * which forms do not show. Adding a listener needs no user activation, so none is granted: activation would let the
 * page, or an embedded frame and every page above it, act as if the person had just clicked.
 */
export function watchUnsavedFormEdits(tab: BrowserTab, frame?: WebFrameMain): void {
  const run = frame ? frame.executeJavaScript(WATCH_FORM_EDITS_SCRIPT, false) : tab.webContents.executeJavaScript(WATCH_FORM_EDITS_SCRIPT, false)
  void run.catch(() => undefined)
}
