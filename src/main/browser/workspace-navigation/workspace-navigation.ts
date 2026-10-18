import type {
  BrowserState,
  BrowserWorkspaceNavigationAuditEntry,
  BrowserWorkspaceNavigationAuditSource,
  BrowserWorkspaceNavigationPolicy
} from '../../../shared/types.js'
import { uuidV7 } from '../../uuid-v7.js'
import { isAgentWorkspaceNavigationUrl } from '../url.js'
import {
  evaluateWorkspaceNavigation,
  normalizeWorkspaceNavigationPolicy,
  type WorkspaceNavigationDecision
} from '../workspace-navigation-policy.js'
import type { WorkspaceNavigationAccess, WorkspaceNavigationTab } from './workspace-navigation-access.js'

/** How many navigation denials one workspace's audit keeps; the oldest is dropped first. */
const MAX_WORKSPACE_NAVIGATION_AUDIT_ENTRIES = 50
/** Chromium's net::ERR_ABORTED error code. */
const ABORTED_LOAD_ERROR = -3

/** Whether a load failed with ERR_ABORTED, as when another navigation replaces it. A copy of the tab manager's check. */
function isAbortedLoad(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const details = error as Error & { code?: unknown; errno?: unknown }
  return details.code === ABORTED_LOAD_ERROR
    || details.errno === ABORTED_LOAD_ERROR
    || details.code === 'ERR_ABORTED'
    || /\bERR_ABORTED\b|\(-3\)\s+loading\b/.test(error.message)
}

/** The error for a denied navigation that no Site access rule could allow. */
const AGENT_NAVIGATION_SCHEME_ERROR = 'Agent workspaces cannot open local, privileged, or credential-bearing browser URLs.'

/** An active or archived workspace's recorded navigation denials, newest first. */
export function listWorkspaceNavigationAudit<Tab extends WorkspaceNavigationTab>(access: WorkspaceNavigationAccess<Tab>, groupId: string): BrowserWorkspaceNavigationAuditEntry[] {
  const audit = access.findWorkspace(groupId)?.navigationAudit
    ?? access.findArchivedWorkspace(groupId)?.navigationAudit
  if (!audit) throw new Error(`Unknown workspace: ${groupId}.`)
  return [...audit].reverse().map((entry) => ({ ...entry }))
}

/**
 * Replaces an idle workspace's navigation policy. A public observer's single
 * origin cannot change. A changed policy also advances the workspace's
 * inspection permission. Each of the workspace's tabs is then checked against
 * the new policy: the decision is reported, and a denied page is recorded and
 * replaced with a blank page.
 */
export async function updateWorkspaceNavigationPolicy<Tab extends WorkspaceNavigationTab>(
  access: WorkspaceNavigationAccess<Tab>,
  groupId: string,
  value: BrowserWorkspaceNavigationPolicy
): Promise<BrowserState> {
  const group = access.findWorkspace(groupId)
  if (!group) throw new Error(`Unknown workspace: ${groupId}.`)
  access.assertWorkspaceIdle(groupId)
  const policy = normalizeWorkspaceNavigationPolicy(value)
  if (group.contextClass === 'public-observer'
    && JSON.stringify(policy) !== JSON.stringify(group.navigationPolicy)) {
    throw new Error('A public observer origin cannot be changed or widened.')
  }
  if (JSON.stringify(policy) !== JSON.stringify(group.navigationPolicy)) access.setInspectionPermission(group, (access.inspectionPermission(group) ?? 0) + 1)
  group.navigationPolicy = policy
  group.lastUsedAt = new Date().toISOString()
  for (const tab of access.tabs()) {
    if (tab.mcpGroupId !== groupId) continue
    const decision = workspaceNavigationDecision(access, groupId, tab.url)
    access.options().onWorkspaceNavigationDecision?.(groupId, decision, 'policy-change')
    if (decision.allowed) continue
    recordWorkspaceNavigationDenied(access, groupId, decision, 'policy-change')
    access.prepareDiagnosticNavigation(tab)
    try {
      await tab.webContents.loadURL('about:blank')
    } catch (error) {
      if (!isAbortedLoad(error)) throw error
    }
  }
  access.changed()
  return access.getState()
}

/**
 * The workspace policy's decision for a URL. A URL the policy allows is still
 * denied as an unsupported scheme unless agent workspaces may open it at all.
 */
function workspaceNavigationDecision<Tab extends WorkspaceNavigationTab>(access: WorkspaceNavigationAccess<Tab>, groupId: string, url: string): WorkspaceNavigationDecision {
  const group = access.findWorkspace(groupId)
  if (!group) throw new Error(`Unknown workspace: ${groupId}.`)
  const decision = evaluateWorkspaceNavigation(group.navigationPolicy, url)
  if (isAgentWorkspaceNavigationUrl(url) || !decision.allowed) return decision
  return { allowed: false, targetOrigin: decision.targetOrigin, reason: 'unsupported-scheme' }
}

/**
 * Adds a denial to the workspace's audit, skipping a repeat of the latest
 * entry within a second and keeping the most recent entries up to the limit.
 */
function recordWorkspaceNavigationDenied<Tab extends WorkspaceNavigationTab>(
  access: WorkspaceNavigationAccess<Tab>,
  groupId: string,
  decision: WorkspaceNavigationDecision,
  source: BrowserWorkspaceNavigationAuditSource
): void {
  if (decision.allowed || (
    decision.reason !== 'credentials'
    && decision.reason !== 'malformed'
    && decision.reason !== 'unsupported-scheme'
    && decision.reason !== 'no-match'
  )) return
  const group = access.findWorkspace(groupId)
  if (!group) return
  const previous = group.navigationAudit.at(-1)
  if (
    previous
    && previous.targetOrigin === decision.targetOrigin
    && previous.reason === decision.reason
    && previous.source === source
    && Date.now() - Date.parse(previous.timestamp) < 1_000
  ) return
  group.navigationAudit.push({
    id: uuidV7(),
    timestamp: new Date().toISOString(),
    targetOrigin: decision.targetOrigin,
    reason: decision.reason,
    source
  })
  if (group.navigationAudit.length > MAX_WORKSPACE_NAVIGATION_AUDIT_ENTRIES) group.navigationAudit.shift()
  access.changed()
}

/** Reports the decision for a navigation, recording a denial, and returns whether the navigation may proceed. */
export function workspaceNavigationAllowed<Tab extends WorkspaceNavigationTab>(
  access: WorkspaceNavigationAccess<Tab>,
  groupId: string,
  url: string,
  source: BrowserWorkspaceNavigationAuditSource
): boolean {
  const decision = workspaceNavigationDecision(access, groupId, url)
  access.options().onWorkspaceNavigationDecision?.(groupId, decision, source)
  if (decision.allowed) return true
  recordWorkspaceNavigationDenied(access, groupId, decision, source)
  return false
}

/**
 * Reports the decision for a navigation, recording a denial, and throws when
 * it is denied. The error names the blocked origin only when a Site access
 * rule could allow it.
 */
export function assertWorkspaceNavigationAllowed<Tab extends WorkspaceNavigationTab>(
  access: WorkspaceNavigationAccess<Tab>,
  groupId: string,
  url: string,
  source: BrowserWorkspaceNavigationAuditSource
): void {
  const decision = workspaceNavigationDecision(access, groupId, url)
  access.options().onWorkspaceNavigationDecision?.(groupId, decision, source)
  if (decision.allowed) return
  recordWorkspaceNavigationDenied(access, groupId, decision, source)
  if (decision.reason !== 'no-match') throw new Error(AGENT_NAVIGATION_SCHEME_ERROR)
  throw new Error(
    `Workspace navigation to ${decision.targetOrigin} is blocked. Allow this origin in the trusted workspace Site access settings.`
  )
}
