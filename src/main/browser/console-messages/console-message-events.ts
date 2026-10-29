import type { WebContents } from 'electron'
import { normalizePageException, type PageExceptionPayload } from '../../../shared/console-exceptions.js'
import type { ConsoleMessagesTab } from './console-messages.js'
import { appendConsoleMessage, withPendingRuntimeConsoleMessage } from './console-messages.js'

/**
 * Captures the page's console messages from Electron's console events, taking
 * a matching pending runtime capture's details, and the uncaught exceptions
 * the page's preload reports.
 */
export function attachConsoleMessageEvents(tab: ConsoleMessagesTab, webContents: WebContents): void {
  webContents.on('console-message', (details) => {
    const { message, runtimeMatched } = withPendingRuntimeConsoleMessage(tab, {
      timestamp: new Date().toISOString(),
      level: details.level,
      message: details.message,
      lineNumber: details.lineNumber,
      sourceId: details.sourceId,
      kind: 'console'
    })
    appendConsoleMessage(tab, message, 'electron')
    if (runtimeMatched) tab.consoleMessages.at(-1)?.captureSources.add('runtime-console')
  })
  webContents.on('ipc-message', (_event, channel, payload: unknown) => {
    if (channel !== 'hronaut:page-exception') return
    const message = normalizePageException(payload as PageExceptionPayload)
    if (message) appendConsoleMessage(tab, message, 'preload')
  })
}
