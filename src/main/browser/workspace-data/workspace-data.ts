import { session, type Session } from 'electron'
import type { BrowserWorkspaceStorageTransferOptions, BrowserWorkspaceStorageTransferResult } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { keepSessionCookies, saveSessionCookies } from '../session-cookies/saved-session-cookies.js'
import { withWorkspaceMoveGuard } from '../workspace-move-guard.js'
import {
  normalizeWorkspaceStorageOrigins,
  transferWorkspaceStorage as transferPartitionStorage,
  workspacePartition
} from '../workspace-storage.js'
import type { WorkspaceDataAccess } from './workspace-data-access.js'

/** A workspace that is gone: agents read its id, the person that it is no longer available. */
function unknownWorkspace(workspaceId: string): LocalizedError {
  return new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${workspaceId}.` })
}

/** The origins an open or archived workspace keeps site data for. */
export function listWorkspaceStorageOrigins(access: WorkspaceDataAccess, workspaceId: string): string[] {
  const workspace = access.mcpTabGroups().get(workspaceId) ?? access.savedTabGroups().get(workspaceId)
  if (!workspace) throw unknownWorkspace(workspaceId)
  return [...workspace.origins]
}

/** The configured session of an open workspace's isolated storage. */
export function workspaceSession(access: WorkspaceDataAccess, workspaceId: string): Session {
  const workspace = access.mcpTabGroups().get(workspaceId)
  if (!workspace) throw unknownWorkspace(workspaceId)
  const partition = workspacePartition(access.options().partition, workspace.storageId)
  const browserSession = session.fromPartition(partition, { cache: true })
  access.options().configureSession?.(browserSession)
  return browserSession
}

/**
 * Runs a website data cleanup on an open workspace's session while it holds the workspace and every workspace's storage
 * busy. Its saved session cookies are back first and saved again after, so cookies it clears do not come back.
 */
export async function withWorkspaceSiteDataCleanup<T>(
  access: WorkspaceDataAccess,
  workspaceId: string,
  operation: (browserSession: Session) => Promise<T>
): Promise<T> {
  return access.withWorkspaceStorageOperation(
    workspaceId,
    'clearing website data',
    async () => {
      const browserSession = workspaceSession(access, workspaceId)
      await keepSessionCookies(browserSession)
      try {
        return await operation(browserSession)
      } finally {
        await saveSessionCookies(browserSession)
      }
    },
    true
  )
}

/**
 * Copies, or for two archived workspaces moves, sign-ins and site data from
 * one workspace to another, holding both and every workspace's storage busy,
 * and refusing a workspace the person just closed.
 */
export async function transferWorkspaceStorage(
  access: WorkspaceDataAccess,
  options: BrowserWorkspaceStorageTransferOptions
): Promise<BrowserWorkspaceStorageTransferResult> {
  const sourceId = options.sourceWorkspaceId
  const targetId = options.targetWorkspaceId
  if (sourceId === targetId) throw new LocalizedError('appErrors.workspaceData.sameWorkspace')
  const source = access.mcpTabGroups().get(sourceId) ?? access.savedTabGroups().get(sourceId)
  const target = access.mcpTabGroups().get(targetId) ?? access.savedTabGroups().get(targetId)
  if (!source || !target) throw new LocalizedError('appErrors.workspaceData.unavailable')
  const closing = [source, target].find((workspace) => access.isClosingWorkspace(workspace.id))
  if (closing) throw new LocalizedError('appErrors.workspaceData.justClosed', { name: closing.name })
  const mode = options.mode
  if (mode === 'move' && (!access.savedTabGroups().has(sourceId) || !access.savedTabGroups().has(targetId))) throw new LocalizedError('appErrors.workspaceData.moveRequiresArchive')
  const action = mode === 'move' ? 'moving workspace data' : 'copying workspace data'
  const lock = <T>(id: string, operation: () => Promise<T>): Promise<T> => (
    access.mcpTabGroups().has(id)
      ? access.withWorkspaceOperation(id, action, operation, mode === 'move')
      : access.withSavedWorkspaceOperation(id, action, operation)
  )
  return access.withGlobalWorkspaceStorageOperation(action, () => lock(sourceId, () => lock(targetId, async () => {
    const origins = normalizeWorkspaceStorageOrigins(options.origins ?? source.origins)
    const copy = (permissions = { allowCookieCleanup: false, allowLocalStorageCleanup: false }) => transferPartitionStorage({
      ...permissions,
      sourcePartition: workspacePartition(access.options().partition, source.storageId),
      targetPartition: workspacePartition(access.options().partition, target.storageId),
      mode,
      origins,
      copyAllCookies: options.origins === undefined,
      copyLocalStorage: true,
      configureSession: access.options().configureSession
    })
    const sourceSession = session.fromPartition(workspacePartition(access.options().partition, source.storageId))
    const targetSession = session.fromPartition(workspacePartition(access.options().partition, target.storageId))
    const result = mode === 'move'
      ? await withWorkspaceMoveGuard(sourceSession, permissions => withWorkspaceMoveGuard(targetSession, () => copy(permissions)))
      : await copy()
    target.origins = normalizeWorkspaceStorageOrigins([...target.origins, ...origins])
    if ('lastUsedAt' in target) target.lastUsedAt = new Date().toISOString()
    access.changed()
    return {
      sourceWorkspaceId: sourceId,
      targetWorkspaceId: targetId,
      mode,
      ...result
    }
  })))
}
