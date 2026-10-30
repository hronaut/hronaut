import { NAVIGATION_IPC } from '../../shared/ipc/navigation.js'
import type { HronautNavigationApi } from '../../shared/types.js'
import { invoke } from './ipc.js'

/** window.hronaut's navigation, find in page, zoom, Save as PDF and Developer Tools for a tab. */
export const navigationApi: HronautNavigationApi = {
  navigate: (options) => invoke(NAVIGATION_IPC.navigate, options),
  back: (tabId) => invoke(NAVIGATION_IPC.back, tabId),
  forward: (tabId) => invoke(NAVIGATION_IPC.forward, tabId),
  showHistoryMenu: (options) => invoke(NAVIGATION_IPC.showHistoryMenu, options),
  openNavigationInNewTab: (options) => invoke(NAVIGATION_IPC.openNavigationInNewTab, options),
  reload: (tabId) => invoke(NAVIGATION_IPC.reload, tabId),
  proceedPastCertificateError: (tabId) => invoke(NAVIGATION_IPC.proceedPastCertificateError, tabId),
  reloadIgnoringCache: (tabId) => invoke(NAVIGATION_IPC.reloadIgnoringCache, tabId),
  stop: (tabId) => invoke(NAVIGATION_IPC.stop, tabId),
  findInPage: (options) => invoke(NAVIGATION_IPC.findInPage, options),
  stopFindInPage: (tabId, options) => invoke(NAVIGATION_IPC.stopFindInPage, tabId, options),
  setZoom: (options) => invoke(NAVIGATION_IPC.setZoom, options),
  savePdf: (options = {}) => invoke(NAVIGATION_IPC.savePdf, options),
  toggleDevTools: (tabId) => invoke(NAVIGATION_IPC.toggleDevTools, tabId),
  showDevToolsConsole: (tabId) => invoke(NAVIGATION_IPC.showDevToolsConsole, tabId)
}
