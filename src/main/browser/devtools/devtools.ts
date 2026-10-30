import type { WebContents } from 'electron'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import { LocalizedError } from '../../localized-error.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { applyNetworkRoutes, requireNetworkConditionsKnown } from '../network-conditions/network-conditions.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'

/** How long Developer Tools get to turn to the Console once open. */
const SHOW_CONSOLE_WAIT_MS = 5_000

/**
 * Opens Developer Tools for the person's tab, or closes them when open, and
 * reports whether they are now open. Hronaut Home has none, and a locked tab
 * only closes them.
 */
export async function toggleDevTools(browser: Browser, tabId?: string): Promise<boolean> {
  const tab = getTab(browser, tabId)
  await browser.wakeTab(tab.id)
  const webContents = tab.webContents
  if (isHronautHomeUrl(tab.url)) return false
  if (browser.isHumanInteractionLocked(tab)) {
    if (webContents.isDevToolsOpened()) webContents.closeDevTools()
    return false
  }
  if (webContents.isDevToolsOpened()) {
    webContents.closeDevTools()
    return false
  }
  await openDevTools(browser, tab)
  return true
}

/**
 * Opens Developer Tools for the person's tab on its Console, or turns open ones to it, as Chrome's Ctrl+Shift+J does,
 * and reports whether they show it. Hronaut Home has none, and a locked tab gets none.
 */
export async function showDevToolsConsole(browser: Browser, tabId?: string): Promise<boolean> {
  const tab = getTab(browser, tabId)
  await browser.wakeTab(tab.id)
  if (isHronautHomeUrl(tab.url) || browser.isHumanInteractionLocked(tab)) return false
  await openDevTools(browser, tab)
  const devTools = tab.webContents.isDestroyed() ? null : tab.webContents.devToolsWebContents
  if (!devTools || devTools.isDestroyed() || !await showConsolePanel(devTools)) return false
  // Opening them gave them the keyboard already. Focusing them first brings Hronaut's window forward, which Electron
  // counts as their owner, so it would take the keyboard back from them; only open ones without it are focused.
  if (!devTools.isDestroyed() && !devTools.isFocused()) devTools.focus()
  return true
}

/**
 * Makes the front end's own call for the Console, which Chrome makes for this key, and reports whether it ran; the
 * Console then has the keyboard in its prompt. Electron can leave the call waiting for good once Developer Tools
 * close, so it also ends then, or after SHOW_CONSOLE_WAIT_MS.
 */
function showConsolePanel(devTools: WebContents): Promise<boolean> {
  return new Promise((resolve) => {
    const settle = (shown: boolean): void => {
      clearTimeout(timer)
      devTools.removeListener('destroyed', fail)
      resolve(shown)
    }
    const fail = (): void => settle(false)
    const timer = setTimeout(fail, SHOW_CONSOLE_WAIT_MS)
    devTools.once('destroyed', fail)
    devTools.executeJavaScript("DevToolsAPI.showPanel('console')").then(() => settle(true), fail)
  })
}

/**
 * Hands the tab's page to a detached Developer Tools window after clearing
 * its request routes and waiting for dialog monitoring and queued debugger
 * commands. It throws when the tab, its page or its debugger changed, or its
 * request conditions are not confirmed, and checks them again with no await
 * before the debugger is detached. Hronaut Home gets none, whichever action
 * asks, also when the tab shows Home by the time the wait ends.
 */
export async function openDevTools(browser: Browser, tab: BrowserTab): Promise<void> {
  const webContents = tab.webContents
  if (webContents.isDestroyed() || webContents.isDevToolsOpened() || isHronautHomeUrl(tab.url)) return
  const debuggerEpoch = tab.networkDebuggerEpoch
  const validateOwnership = (): void => {
    if (browser.destroyed || webContents.isDestroyed() || findTab(browser, tab.id) !== tab || tab.webContents !== webContents || tab.networkDebuggerEpoch !== debuggerEpoch) throw new LocalizedError('appErrors.devTools.targetChanged')
    requireNetworkConditionsKnown(tab)
  }
  const requireConfirmed = (): void => {
    validateOwnership()
    if (tab.networkConditionApplication !== 'confirmed') throw new LocalizedError('appErrors.devTools.conditionsPending')
  }
  requireConfirmed()
  // DevTools cleanup is an ordinary mutation, never explicit recovery authority.
  // Its queue admission must reject uncertainty created by an earlier operation.
  if (tab.networkRoutes.length) await applyNetworkRoutes(browser, tab, validateOwnership, false, () => { tab.networkRoutes = [] })
  browser.devToolsOpening.add(webContents.id)
  try {
    await browser.dialogMonitorAttachPromises.get(webContents.id)
    const pendingDebugger = browser.debuggerQueue.pending(webContents.id)
    if (pendingDebugger) await pendingDebugger
    // The queue tail settles even after failure. Check current health and the
    // original owner at the handoff itself, with no await before detachment.
    requireConfirmed()
    if (tab.networkRoutes.length) throw new LocalizedError('appErrors.devTools.conditionsChanged')
    if (webContents.isDevToolsOpened() || isHronautHomeUrl(tab.url)) return
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
          title: browser.text('native.dialog.devToolsWindowTitle', { title: tabTitleForDisplay(tab, browser.text('tabSearch.newTabTitle')) })
        })
        if (webContents.isDevToolsOpened()) finish()
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  } finally {
    browser.devToolsOpening.delete(webContents.id)
  }
}
