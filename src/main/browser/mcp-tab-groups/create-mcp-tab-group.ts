import { randomUUID } from 'node:crypto'
import type { BrowserTabGroupState, BrowserWorkspaceContextClass, BrowserWorkspaceNavigationPolicy } from '../../../shared/types.js'
import { defaultTabGroupColor, type BrowserTabGroupColor } from '../../../shared/tab-groups.js'
import { normalizeWorkspaceDescription } from '../../../shared/workspace-description.js'
import { LocalizedError } from '../../localized-error.js'
import { uuidV7 } from '../../uuid-v7.js'
import { RetainedBrowserWorkspaceError } from '../workspace-errors.js'
import { normalizeWorkspaceNavigationPolicy } from '../workspace-navigation-policy.js'
import type { ActiveWorkspace as BrowserTabGroup } from '../workspace-registry.js'
import {
  destroyWorkspaceStorage,
  normalizeWorkspaceStorageOrigins,
  transferWorkspaceStorage,
  workspacePartition
} from '../workspace-storage.js'
import type { Browser } from '../browser.js'
import { withGlobalWorkspaceStorageOperation, withSavedWorkspaceOperation, withWorkspaceOperation } from '../workspace-operations/workspace-operations.js'
import { assertActiveWorkspaceCapacity } from '../workspace-creation/workspace-capacity.js'
import { publishChange } from '../browser-state/browser-state.js'
import { normalizedWorkspaceName, requireMcpTabGroup } from './mcp-tab-groups.js'

/**
 * The one HTTP(S) origin a restricted policy allows, which a public observer workspace requires, or undefined. A
 * subdomain wildcard such as `https://*.example.com` parses as an origin too, but allows every subdomain.
 */
function publicObserverOrigin(policy: BrowserWorkspaceNavigationPolicy): string | undefined {
  if (policy.mode !== 'restricted' || policy.rules.length !== 1 || policy.rules[0]!.includes('*')) return undefined
  try {
    const parsed = new URL(policy.rules[0]!)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && !parsed.username
      && !parsed.password
      && policy.rules[0] === parsed.origin
      ? parsed.origin
      : undefined
  } catch {
    return undefined
  }
}

/**
 * The Site access rules of a copy of a workspace when it is created: never looser than the source's. "Any safe website",
 * or no choice at all as from an agent's fork, keeps the source's rules. Listed rules apply when the source allows every
 * site, or when the source lists each of them too, compared in their normalized form. Any other rule is refused rather
 * than dropped, so the copy never allows less than the person listed for it, nor more than its source.
 */
function forkNavigationPolicy(
  source: { name: string; navigationPolicy: BrowserWorkspaceNavigationPolicy },
  requested: BrowserWorkspaceNavigationPolicy
): BrowserWorkspaceNavigationPolicy {
  const inherited = normalizeWorkspaceNavigationPolicy(source.navigationPolicy)
  if (requested.mode === 'unrestricted') return inherited
  if (inherited.mode === 'unrestricted' || requested.rules.every((rule) => inherited.rules.includes(rule))) return requested
  throw new LocalizedError('appErrors.workspace.forkSiteAccess', { name: source.name })
}

/**
 * Creates an open workspace with clean scratch storage, or one that copies
 * another workspace's storage and opens a blank tab. A failed copy deletes the
 * new storage, or keeps the workspace listed when that cleanup fails too, so
 * its isolated data can still be deleted.
 */
export async function createMcpTabGroup(
  browser: Browser,
  name: string,
  color?: BrowserTabGroupColor,
  storage: 'scratch' | 'fork-workspace' = 'scratch',
  origins?: string[],
  allowDuplicateName = false,
  navigationPolicy?: BrowserWorkspaceNavigationPolicy,
  sourceWorkspaceId?: string,
  description = '',
  contextClass: BrowserWorkspaceContextClass = 'standard'
): Promise<BrowserTabGroupState> {
  const normalizedPolicy = normalizeWorkspaceNavigationPolicy(navigationPolicy)
  if (contextClass === 'public-observer' && (storage !== 'scratch' || !publicObserverOrigin(normalizedPolicy))) {
    throw new LocalizedError('appErrors.workspace.observerRequirements')
  }
  const normalizedName = normalizedWorkspaceName(name)
  browser.assertWorkspaceNameAvailable(normalizedName, undefined, undefined, allowDuplicateName)
  assertActiveWorkspaceCapacity(browser)
  const now = new Date().toISOString()
  const id = uuidV7()
  const storageId = randomUUID()
  const group: BrowserTabGroup = {
    id,
    name: normalizedName,
    description: normalizeWorkspaceDescription(description),
    color: color ?? defaultTabGroupColor(id),
    createdAt: now,
    lastUsedAt: now,
    activeTabId: null,
    storageId,
    origins: [],
    navigationPolicy: normalizedPolicy,
    navigationAudit: [],
    contextClass
  }
  if (storage === 'fork-workspace') {
    const sourceId = sourceWorkspaceId
    const source = sourceId ? browser.mcpTabGroups.get(sourceId) ?? browser.savedTabGroups.get(sourceId) : undefined
    if (!source) throw new LocalizedError('appErrors.workspace.sourceUnavailable')
    if (browser.isClosingWorkspace(sourceId!)) throw new LocalizedError('appErrors.workspace.sourceJustClosed', { name: source.name })
    group.navigationPolicy = forkNavigationPolicy(source, normalizedPolicy)
    const fork = async () => {
      browser.mcpTabGroups.set(group.id, group)
      // Home can already read this workspace while its storage is copying.
      // Publish it to chrome too, without persisting an unfinished fork.
      publishChange(browser, false)
      let selectedOrigins: string[] = []
      try {
        selectedOrigins = normalizeWorkspaceStorageOrigins(origins ?? source.origins)
        await withWorkspaceOperation(browser, group.id, 'forking workspace data', () => (
          transferWorkspaceStorage({
            sourcePartition: workspacePartition(browser.options.partition, source.storageId),
            targetPartition: workspacePartition(browser.options.partition, storageId),
            origins: selectedOrigins,
            copyAllCookies: origins === undefined,
            copyLocalStorage: true,
            configureSession: browser.options.configureSession
          })
        ), true)
        group.origins = selectedOrigins
        if (storage === 'fork-workspace') await browser.createTab({ url: 'about:blank', active: false, mcpGroupId: group.id })
      } catch (error) {
        try {
          await destroyWorkspaceStorage(
            workspacePartition(browser.options.partition, storageId),
            browser.options.configureSession
          )
        } catch (cleanupError) {
          group.origins = selectedOrigins
          publishChange(browser)
          throw new RetainedBrowserWorkspaceError(
            [error, cleanupError],
            group.id,
            `Workspace ${group.id} could not be created or cleaned up. It remains listed so its isolated data can be deleted safely.`
          )
        }
        browser.mcpTabGroups.delete(group.id)
        publishChange(browser)
        throw error
      }
      publishChange(browser)
      return requireMcpTabGroup(browser, group.id)
    }
    return withGlobalWorkspaceStorageOperation(browser, 'forking workspace data', () => (
      browser.mcpTabGroups.has(source.id)
        ? withWorkspaceOperation(browser, source.id, 'forking workspace data', fork, false)
        : withSavedWorkspaceOperation(browser, source.id, 'forking workspace data', fork)
    ))
  }
  browser.mcpTabGroups.set(group.id, group)
  publishChange(browser)
  return requireMcpTabGroup(browser, group.id)
}
