import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import { LocalizedError } from '../../localized-error.js'
import { isHronautHomeUrl } from '../url.js'
import type { DevToolsAccess, DevToolsTab } from './devtools-access.js'

/**
 * Opens Developer Tools for the person's tab, or closes them when open, and
 * reports whether they are now open. Hronaut Home has none, and a locked tab
 * only closes them.
 */
export async function toggleDevTools<Tab extends DevToolsTab>(access: DevToolsAccess<Tab>, tabId?: string): Promise<boolean> {
  const tab = access.getTab(tabId)
  await access.wakeTab(tab.id)
  const webContents = tab.webContents
  if (isHronautHomeUrl(tab.url)) return false
  if (access.isHumanInteractionLocked(tab)) {
    if (webContents.isDevToolsOpened()) webContents.closeDevTools()
    return false
  }
  if (webContents.isDevToolsOpened()) {
    webContents.closeDevTools()
    return false
  }
  await openDevTools(access, tab)
  return true
}

/**
 * Hands the tab's page to a detached Developer Tools window after clearing
 * its request routes and waiting for dialog monitoring and queued debugger
 * commands. It throws when the tab, its page or its debugger changed, or its
 * request conditions are not confirmed, and checks them again with no await
 * before the debugger is detached.
 */
export async function openDevTools<Tab extends DevToolsTab>(access: DevToolsAccess<Tab>, tab: Tab): Promise<void> {
  const webContents = tab.webContents
  if (webContents.isDestroyed() || webContents.isDevToolsOpened()) return
  const debuggerEpoch = tab.networkDebuggerEpoch
  const validateOwnership = (): void => {
    if (access.isDestroyed() || webContents.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== webContents || tab.networkDebuggerEpoch !== debuggerEpoch) throw new LocalizedError('appErrors.devTools.targetChanged')
    access.requireNetworkConditionsKnown(tab)
  }
  const requireConfirmed = (): void => {
    validateOwnership()
    if (tab.networkConditionApplication !== 'confirmed') throw new LocalizedError('appErrors.devTools.conditionsPending')
  }
  requireConfirmed()
  // DevTools cleanup is an ordinary mutation, never explicit recovery authority.
  // Its queue admission must reject uncertainty created by an earlier operation.
  if (tab.networkRoutes.length) await access.applyNetworkRoutes(tab, validateOwnership, false, () => { tab.networkRoutes = [] })
  access.devToolsOpening().add(webContents.id)
  try {
    await access.dialogMonitorAttach(webContents.id)
    const pendingDebugger = access.pendingDebuggerCommand(webContents.id)
    if (pendingDebugger) await pendingDebugger
    // The queue tail settles even after failure. Check current health and the
    // original owner at the handoff itself, with no await before detachment.
    requireConfirmed()
    if (tab.networkRoutes.length) throw new LocalizedError('appErrors.devTools.conditionsChanged')
    if (webContents.isDevToolsOpened()) return
    if (webContents.debugger.isAttached()) webContents.debugger.detach()
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        webContents.removeListener('devtools-opened', finish)
        webContents.removeListener('destroyed', finish)
      }
      const finish = (): void => {
        cleanup()
        resolve()
      }
      webContents.once('devtools-opened', finish)
      webContents.once('destroyed', finish)
      try {
        webContents.openDevTools({
          mode: 'detach',
          title: access.text('native.dialog.devToolsWindowTitle', { title: tabTitleForDisplay(tab, access.text('tabSearch.newTabTitle')) })
        })
        if (webContents.isDevToolsOpened()) finish()
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  } finally {
    access.devToolsOpening().delete(webContents.id)
  }
}
