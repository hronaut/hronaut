import { session, type Cookie } from 'electron'
import { BrowserImportError } from '../../browser-import/contracts.js'
import type { ImportDestination } from '../../browser-import/service.js'
import { writeImportedCookies } from '../../browser-import/write.js'
import { keepSessionCookies } from '../session-cookies/saved-session-cookies.js'
import { evaluateWorkspaceNavigation } from '../workspace-navigation-policy.js'
import { normalizeWorkspaceStorageOrigins, workspacePartition } from '../workspace-storage.js'
import type { Browser } from '../browser.js'
import { withGlobalWorkspaceStorageOperation, withSavedWorkspaceOperation, withWorkspaceOperation } from '../workspace-operations/workspace-operations.js'
import { publishChange } from '../browser-state/browser-state.js'

/**
 * An open or archived workspace as a browser import destination, with a
 * fingerprint of its storage and navigation policy so an import can tell
 * that it changed meanwhile.
 */
export function browserImportDestination(browser: Browser, id: string): ImportDestination {
  const group = browser.mcpTabGroups.get(id) ?? browser.savedTabGroups.get(id)
  if (!group) throw new BrowserImportError('expired')
  return { id, name: group.name, fingerprint: JSON.stringify([group.storageId, group.navigationPolicy]) }
}

/**
 * Writes cookies imported from another browser into a workspace's isolated
 * storage, keeping only those its navigation policy allows, while no other
 * operation holds the workspace or any workspace's storage busy. The
 * destination must still match its fingerprint when the write starts.
 */
export async function importBrowserCookies(browser: Browser, destination: ImportDestination, cookies: Cookie[]) {
  const id = destination.id
  if (!browser.mcpTabGroups.has(id) && !browser.savedTabGroups.has(id)) throw new BrowserImportError('expired')
  if (browser.workspaceStorageOperation || browser.workspaceOperations.has(id) || browser.savedWorkspaceOperations.has(id)) throw new BrowserImportError('workspaceBusy')
  const action = 'importing browser cookies'
  return withGlobalWorkspaceStorageOperation(browser, action, () => {
    const write = async () => {
      if (browserImportDestination(browser, id).fingerprint !== destination.fingerprint) throw new BrowserImportError('expired')
      const group = (browser.mcpTabGroups.get(id) ?? browser.savedTabGroups.get(id))!
      const target = session.fromPartition(workspacePartition(browser.options.partition, group.storageId))
      browser.options.configureSession?.(target)
      // The sign-ins it saved at the last quit are back first, so the import sees them as the cookies a site has.
      await keepSessionCookies(target)
      browser.browserCookieImportSessions.add(target)
      try {
        const { origins, ...result } = await writeImportedCookies(target, cookies, group.origins,
          cookie => evaluateWorkspaceNavigation(group.navigationPolicy, `${cookie.secure ? 'https' : 'http'}://${cookie.domain!.replace(/^\./, '')}/`).allowed)
        if (result.imported || result.recoveryRequired) {
          group.origins = normalizeWorkspaceStorageOrigins([...group.origins, ...origins])
          publishChange(browser)
        }
        return result
      } finally {
        browser.browserCookieImportSessions.delete(target)
        publishChange(browser, false)
      }
    }
    return browser.mcpTabGroups.has(id)
      ? withWorkspaceOperation(browser, id, action, write)
      : withSavedWorkspaceOperation(browser, id, action, write)
  })
}
