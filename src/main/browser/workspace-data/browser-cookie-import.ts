import { session, type Cookie } from 'electron'
import { BrowserImportError } from '../../browser-import/contracts.js'
import type { ImportDestination } from '../../browser-import/service.js'
import { writeImportedCookies } from '../../browser-import/write.js'
import { evaluateWorkspaceNavigation } from '../workspace-navigation-policy.js'
import { normalizeWorkspaceStorageOrigins, workspacePartition } from '../workspace-storage.js'
import type { WorkspaceDataAccess } from './workspace-data-access.js'

/**
 * An open or archived workspace as a browser import destination, with a
 * fingerprint of its storage and navigation policy so an import can tell
 * that it changed meanwhile.
 */
export function browserImportDestination(access: WorkspaceDataAccess, id: string): ImportDestination {
  const group = access.mcpTabGroups().get(id) ?? access.savedTabGroups().get(id)
  if (!group) throw new BrowserImportError('expired')
  return { id, name: group.name, fingerprint: JSON.stringify([group.storageId, group.navigationPolicy]) }
}

/**
 * Writes cookies imported from another browser into a workspace's isolated
 * storage, keeping only those its navigation policy allows, while no other
 * operation holds the workspace or any workspace's storage busy. The
 * destination must still match its fingerprint when the write starts.
 */
export async function importBrowserCookies(access: WorkspaceDataAccess, destination: ImportDestination, cookies: Cookie[]) {
  const id = destination.id
  if (!access.mcpTabGroups().has(id) && !access.savedTabGroups().has(id)) throw new BrowserImportError('expired')
  if (access.workspaceStorageOperation() || access.workspaceOperations().has(id) || access.savedWorkspaceOperations().has(id)) throw new BrowserImportError('workspaceBusy')
  const action = 'importing browser cookies'
  return access.withGlobalWorkspaceStorageOperation(action, () => {
    const write = async () => {
      if (browserImportDestination(access, id).fingerprint !== destination.fingerprint) throw new BrowserImportError('expired')
      const group = (access.mcpTabGroups().get(id) ?? access.savedTabGroups().get(id))!
      const target = session.fromPartition(workspacePartition(access.options().partition, group.storageId))
      access.options().configureSession?.(target)
      access.browserCookieImportSessions().add(target)
      try {
        const { origins, ...result } = await writeImportedCookies(target, cookies, group.origins,
          cookie => evaluateWorkspaceNavigation(group.navigationPolicy, `${cookie.secure ? 'https' : 'http'}://${cookie.domain!.replace(/^\./, '')}/`).allowed)
        if (result.imported || result.recoveryRequired) {
          group.origins = normalizeWorkspaceStorageOrigins([...group.origins, ...origins])
          access.changed()
        }
        return result
      } finally {
        access.browserCookieImportSessions().delete(target)
        access.changed(false)
      }
    }
    return access.mcpTabGroups().has(id)
      ? access.withWorkspaceOperation(id, action, write)
      : access.withSavedWorkspaceOperation(id, action, write)
  })
}
