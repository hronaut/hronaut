import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'

/**
 * The agent's authority to give the tab's page native input, checked by the
 * caller before each step and released with dispose. It ends when the page
 * commits a new document, the browser closes, the tab's workspace or its
 * inspection permission changes, the tab closes or shows another page, or the
 * tab's observation context changes. validateInput, when given, wraps the
 * check with the call's own.
 */
export function nativeInputAuthority(
  browser: Browser,
  tab: BrowserTab,
  validateInput?: (validateContext: () => void) => void
): { validate: () => void; dispose: () => void } {
  const webContents = tab.webContents
  const context = browser.snapshotDeltaContext(tab)
  const workspace = tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? browser.inspectionPermissions.get(workspace) ?? 0 : 0
  let documentCommitted = false
  const onCommitted = (): void => { documentCommitted = true }
  const assertContext = (): void => {
    const currentWorkspace = tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
    if (documentCommitted || browser.destroyed || currentWorkspace !== workspace
      || (currentWorkspace ? browser.inspectionPermissions.get(currentWorkspace) ?? 0 : 0) !== permissionGeneration
      || browser.tabs.get(tab.id) !== tab || tab.webContents !== webContents || webContents.isDestroyed()
      || snapshotDeltaInvalidationReason(context, browser.snapshotDeltaContext(tab))) {
      throw new Error('Native input context changed; inspect fresh state before continuing. Earlier input effects are not rolled back')
    }
  }
  webContents.on('did-navigate', onCommitted)
  return {
    validate: () => { if (validateInput) validateInput(assertContext); else assertContext() },
    dispose: () => { webContents.removeListener('did-navigate', onCommitted) }
  }
}
