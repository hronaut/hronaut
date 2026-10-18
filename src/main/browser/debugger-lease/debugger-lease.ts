import type { WebContents } from 'electron'
import type { DebuggerLeaseAccess } from './debugger-lease-access.js'

/**
 * Runs a debugger operation on the page in its turn, attaching the debugger
 * and enabling the page, runtime and log domains when it was not attached,
 * and refusing while the page's Developer Tools are open or opening. With
 * validateAdmission, the caller's admission is checked before and after
 * every step up to the operation; without it, a debugger this call attached
 * gets its page and runtime domains enabled again afterwards.
 */
export async function withDebugger<T>(access: DebuggerLeaseAccess, webContents: WebContents, operation: () => Promise<T>, validateAdmission?: () => void): Promise<T> {
  validateAdmission?.()
  return access.inDebuggerQueue(webContents.id, async () => {
    validateAdmission?.()
    await access.dialogMonitorAttach(webContents.id)
    validateAdmission?.()
    if (access.isDevToolsOpening(webContents.id) || webContents.isDevToolsOpened()) {
      throw new Error('Close Developer Tools for this tab before using this MCP action')
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
      if (!validateAdmission && attachedHere && webContents.debugger.isAttached() && !access.isDestroyed()) {
        await webContents.debugger.sendCommand('Page.enable').catch(() => undefined)
        await webContents.debugger.sendCommand('Runtime.enable').catch(() => undefined)
      }
    }
  })
}
