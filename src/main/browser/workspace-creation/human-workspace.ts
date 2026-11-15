import { randomUUID } from 'node:crypto'
import { defaultTabGroupColor } from '../../../shared/tab-groups.js'
import { suggestWorkspaceName } from '../../../shared/workspace-names.js'
import { uuidV7 } from '../../uuid-v7.js'
import type { Browser } from '../browser.js'
import { assertActiveWorkspaceCapacity } from './workspace-capacity.js'

/**
 * The workspace a tab the person opens joins: the active tab's, else the
 * first open one, else a new empty workspace with a suggested name.
 */
export function ensureHumanWorkspace(browser: Browser): string {
  const activeGroupId = browser.activeTabId ? browser.tabs.get(browser.activeTabId)?.mcpGroupId : undefined
  if (activeGroupId && browser.mcpTabGroups.has(activeGroupId)) return activeGroupId
  const existing = browser.mcpTabGroups.keys().next().value as string | undefined
  if (existing) return existing
  assertActiveWorkspaceCapacity(browser)
  const now = new Date().toISOString()
  const id = uuidV7()
  browser.mcpTabGroups.set(id, {
    id,
    name: suggestWorkspaceName([...browser.mcpTabGroups.values(), ...browser.savedTabGroups.values()].map(group => group.name)),
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
