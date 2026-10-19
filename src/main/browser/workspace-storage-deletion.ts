import { lstat, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { basename, dirname, join, parse, resolve } from 'node:path'
import { writeTextFileAtomically } from '../atomic-file.js'
import { LocalizedError } from '../localized-error.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function canonicalStorageId(value: unknown): string | undefined {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : undefined
}
type Metadata = Record<string, unknown> & {
  mcpTabGroups: Array<{ id: string; storageId: string }>
  savedTabGroups: Array<{ id: string; storageId: string }>
  deletedWorkspaceStorageIds?: string[]
  workspaceStorageCleanupBlocked?: boolean
}
async function readAuthority(path: string): Promise<Metadata> {
  const files = await readdir(dirname(path))
  // Atomic-save remnants and recovery copies can still reference old profiles.
  if (files.some(name => name.startsWith(`${basename(path)}.`))) throw new LocalizedError('appErrors.workspaceStorage.metadataRecovery')
  if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink()) throw new LocalizedError('appErrors.workspaceStorage.metadataNotFile')
  const data: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!data || typeof data !== 'object') throw new LocalizedError('appErrors.workspaceStorage.metadataUnavailable')
  const record = data as Metadata
  if (record.version !== 3 || !Array.isArray(record.tabs)
    || !Array.isArray(record.mcpTabGroups) || !Array.isArray(record.savedTabGroups)
    || [...record.mcpTabGroups, ...record.savedTabGroups].some(group => !group || typeof group.id !== 'string' || !canonicalStorageId(group.storageId))
    || (record.deletedWorkspaceStorageIds !== undefined && (!Array.isArray(record.deletedWorkspaceStorageIds)
      || record.deletedWorkspaceStorageIds.some(id => !canonicalStorageId(id))))
    || (record.workspaceStorageCleanupBlocked !== undefined && typeof record.workspaceStorageCleanupBlocked !== 'boolean')) {
    throw new LocalizedError('appErrors.workspaceStorage.metadataUnauthorized')
  }
  const ids = [...record.mcpTabGroups, ...record.savedTabGroups].map(group => canonicalStorageId(group.storageId))
  if (new Set(ids).size !== ids.length) throw new LocalizedError('appErrors.workspaceStorage.referencesOverlap')
  return record
}

export async function assertExclusiveWorkspaceStorage(path: string, workspaceId: string, storageId: string): Promise<void> {
  const canonical = canonicalStorageId(storageId)
  if (!canonical) throw new LocalizedError('appErrors.workspaceStorage.identityInvalid')
  const raw = await readAuthority(path)
  if (raw.workspaceStorageCleanupBlocked || [...raw.mcpTabGroups, ...raw.savedTabGroups]
    .some(group => group.id !== workspaceId && canonicalStorageId(group.storageId) === canonical)) {
    throw new LocalizedError('appErrors.workspaceStorage.ambiguousOwnership')
  }
}

async function ordinaryDirectoryChain(path: string): Promise<void> {
  let current = resolve(path)
  while (true) {
    const entry = await lstat(current)
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new LocalizedError('appErrors.workspaceStorage.ordinaryDirectories')
    if (current === parse(current).root) break
    current = dirname(current)
  }
  if (await realpath(path) !== resolve(path)) throw new LocalizedError('appErrors.workspaceStorage.pathChanged')
}
async function rejectLinkedTree(path: string): Promise<void> {
  const queue = [path]
  let inspected = 0
  while (queue.length) {
    const current = queue.pop()!
    const entry = await lstat(current)
    if (++inspected > 100_000 || entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new LocalizedError('appErrors.workspaceStorage.treeReview')
    if (entry.isDirectory()) for (const name of await readdir(current)) queue.push(join(current, name))
  }
}

/** Cold-start only, before native workspace sessions exist. Never discovers orphan folders.
 * Filesystem paths are trusted against concurrent local replacement, not a secure-erasure API.
 */
export async function cleanExplicitlyDeletedWorkspaceStorage(
  metadataPath: string, sessionDataPath: string, partition: string
): Promise<{ metadataBlocked: boolean }> {
  let data: Metadata
  try { data = await readAuthority(metadataPath) }
  catch { return { metadataBlocked: true } }
  if (data.workspaceStorageCleanupBlocked) return { metadataBlocked: true }
  const pending = [...new Set(data.deletedWorkspaceStorageIds?.map(id => canonicalStorageId(id)!))]
  if (!pending.length) return { metadataBlocked: false }
  if (!/^persist:[a-z0-9-]+$/.test(partition)) return { metadataBlocked: false }
  const references = new Set([...data.mcpTabGroups, ...data.savedTabGroups].map(group => canonicalStorageId(group.storageId)))
  const root = join(sessionDataPath, 'Partitions')
  const remaining = new Set(pending)
  for (const id of pending) {
    if (references.has(id)) continue
    const target = join(root, `${partition.slice('persist:'.length)}-workspace-${id}`)
    try {
      await ordinaryDirectoryChain(root)
      try { await rejectLinkedTree(target) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      // rm does not follow symlinks. Recheck ancestors immediately before removal;
      // concurrent hostile filesystem mutation is outside the app's profile model.
      await ordinaryDirectoryChain(root)
      await rm(target, { recursive: true, force: true })
      remaining.delete(id)
    } catch { /* Retain explicit intent after busy files, unsafe paths, or partial removal. */ }
  }
  if (remaining.size !== pending.length) {
    try {
      await writeTextFileAtomically(metadataPath, `${JSON.stringify({ ...data, deletedWorkspaceStorageIds: [...remaining] }, null, 2)}\n`)
    } catch {
      // Removal already happened; the actual committed metadata remains authoritative.
      // Retrying an absent directory is safe, and unrelated workspaces must still open.
      console.warn('[browser] Deleted workspace cleanup completion could not be saved; any remaining cleanup intent will be retried.')
    }
  }
  return { metadataBlocked: false }
}
