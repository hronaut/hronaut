import type { WebContents } from 'electron'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'

/**
 * Runs a debugger operation on the page in its turn, attaching the debugger
 * and enabling the page, runtime and log domains when it was not attached,
 * and refusing while the page's Developer Tools are open or opening. With
 * validateAdmission, the caller's admission is checked before and after
 * every step up to the operation; without it, a debugger this call attached
 * gets its page and runtime domains enabled again afterwards.
 */
export async function withDebugger<T>(browser: Browser, webContents: WebContents, operation: () => Promise<T>, validateAdmission?: () => void): Promise<T> {
  validateAdmission?.()
  return browser.debuggerQueue.run(webContents.id, async () => {
    validateAdmission?.()
    await browser.dialogMonitorAttachPromises.get(webContents.id)
    validateAdmission?.()
    if (browser.devToolsOpening.has(webContents.id) || webContents.isDevToolsOpened()) {
      // Agents read which action waits; a person reads to close Developer Tools and try again.
      throw new LocalizedError('appErrors.pageTools.devToolsOpen', undefined, { message: 'Close Developer Tools for this tab before using this MCP action' })
    }
    const attachedHere = !webContents.debugger.isAttached()
    if (attachedHere) {
      validateAdmission?.()
      webContents.debugger.attach('1.3')
      validateAdmission?.()
      await webContents.debugger.sendCommand('Page.enable')
      validateAdmission?.()
      await webContents.debugger.sendCommand('Runtime.enable')
      validateAdmission?.()
      await webContents.debugger.sendCommand('Runtime.setAsyncCallStackDepth', { maxDepth: 8 }).catch(() => undefined)
      validateAdmission?.()
      await webContents.debugger.sendCommand('Log.enable').catch(() => undefined)
    }
    validateAdmission?.()
    try {
      return await operation()
    } finally {
      if (!validateAdmission && attachedHere && webContents.debugger.isAttached() && !browser.destroyed) {
        await webContents.debugger.sendCommand('Page.enable').catch(() => undefined)
        await webContents.debugger.sendCommand('Runtime.enable').catch(() => undefined)
      }
    }
  })
}
