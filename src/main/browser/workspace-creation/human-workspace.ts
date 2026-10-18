import { randomUUID } from 'node:crypto'
import { defaultTabGroupColor } from '../../../shared/tab-groups.js'
import { suggestWorkspaceName } from '../../../shared/workspace-names.js'
import { uuidV7 } from '../../uuid-v7.js'
import type { WorkspaceCreationAccess } from './workspace-creation-access.js'

/**
 * The workspace a tab the person opens joins: the active tab's, else the
 * first open one, else a new empty workspace with a suggested name.
 */
export function ensureHumanWorkspace(access: WorkspaceCreationAccess): string {
  const activeGroupId = access.activeTabId() ? access.tabs().get(access.activeTabId()!)?.mcpGroupId : undefined
  if (activeGroupId && access.mcpTabGroups().has(activeGroupId)) return activeGroupId
  const existing = access.mcpTabGroups().keys().next().value as string | undefined
  if (existing) return existing
  access.assertActiveWorkspaceCapacity()
  const now = new Date().toISOString()
  const id = uuidV7()
  access.mcpTabGroups().set(id, {
    id,
    name: suggestWorkspaceName([...access.mcpTabGroups().values(), ...access.savedTabGroups().values()].map(group => group.name)),
    description: '',
    color: defaultTabGroupColor(id),
    storageId: randomUUID(),
    createdAt: now,
    lastUsedAt: now,
    activeTabId: null,
    origins: [],
    navigationPolicy: { mode: 'unrestricted', rules: [] },
    navigationAudit: [],
    contextClass: 'standard'
  })
  return id
}
