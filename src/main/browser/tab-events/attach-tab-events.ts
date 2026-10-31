import type { WebContents } from 'electron'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { attachConsoleMessageEvents } from '../console-messages/console-message-events.js'
import { attachPageContextMenuEvents } from '../context-menus/page-context-menu-events.js'
import { attachDevToolsEvents } from '../devtools/devtools-events.js'
import { followSignIns } from '../http-auth/http-auth.js'
import { attachPageFullscreenEvents } from '../page-fullscreen/page-fullscreen.js'
import { runPageScriptsOnceDocumentReady } from '../page-script-readiness.js'
import { attachPageWheelZoom } from '../page-zoom/page-wheel-zoom.js'
import { guardPageCallsDuringPrintDialog } from '../print-dialog-guard.js'
import { guardPageCallsAcrossRendererExit } from '../renderer-exit-guard.js'
import { refusePageScriptsInSourceView } from '../source-view-guard.js'
import { guardPageCallsDuringWebsiteDialog } from '../website-dialog-guard.js'
import { agentAnswersWebsiteDialogs, ensureDialogMonitoring } from '../website-dialogs/website-dialogs.js'
import { attachDebuggerEvents } from './debugger-events.js'
import { attachNavigationEvents } from './navigation-events.js'
import { attachPageDestroyedEvents } from './page-destroyed-events.js'
import { attachPageFocusEvents } from './page-focus-events.js'
import { attachPageKeyboardEvents } from './page-keyboard-events.js'
import { attachPagePointerEvents } from './page-pointer-events.js'
import { attachPageTargetUrlEvents } from './page-target-url-events.js'
import { attachRendererHealthEvents } from './renderer-health-events.js'
import { attachWindowOpenHandler } from './window-open-handler.js'

/** Follows the tab's page from before its first page starts; `openedBy` is the page that opened it as a window. */
export function attachTabEvents(browser: Browser, tab: BrowserTab, openedBy?: WebContents): void {
  const webContents = tab.webContents
  // A page a page opened refuses the sign-ins its opener's tab refuses.
  followSignIns(webContents, openedBy)
  refusePageScriptsInSourceView(webContents)
  guardPageCallsAcrossRendererExit(webContents)
  guardPageCallsDuringPrintDialog(webContents)
  // Hronaut turns a dialog down at once while its own screens cover the pages, and an agent's action answers its own.
  guardPageCallsDuringWebsiteDialog(webContents, () => browser.browserContentOccluded || agentAnswersWebsiteDialogs(webContents))
  runPageScriptsOnceDocumentReady(webContents)
  attachPageDestroyedEvents(browser, tab, webContents)
  attachPageFocusEvents(browser, tab, webContents)
  attachPageKeyboardEvents(browser, tab, webContents)
  attachPagePointerEvents(browser, tab, webContents)
  attachPageTargetUrlEvents(browser, tab, webContents)
  attachPageWheelZoom(browser, tab, webContents)
  attachPageContextMenuEvents(browser, tab, webContents)
  attachDevToolsEvents(browser, tab, webContents)
  browser.frameObservation.track(webContents)
  attachDebuggerEvents(browser, tab, webContents)
  void ensureDialogMonitoring(browser, tab)
  attachNavigationEvents(browser, tab, webContents)
  attachPageFullscreenEvents(browser, tab, webContents)
  attachConsoleMessageEvents(tab, webContents)
  attachRendererHealthEvents(browser, tab, webContents)
  attachWindowOpenHandler(browser, tab, webContents)
}
