import { continuityMarkerScript, readContinuityMarker } from '../../../shared/workspace-continuity-marker.js'
import { browserPostconditionScript, type BrowserPostcondition } from '../../../shared/post-write-postcondition.js'
import {
  browserReconciliationScript,
  type BrowserReconciliationCondition,
  type BrowserReconciliationEvidence
} from '../../../shared/browser-reconciliation.js'
import { readBrowserPostcondition, type PostconditionReadResult } from '../../mcp/post-write-browser-read.js'
import { compareWorkspaceContinuity, type WorkspaceContinuityResult } from '../../mcp/workspace-continuity.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import type { WorkspaceContinuityAccess, WorkspaceContinuityTab } from './workspace-continuity-access.js'

const CONTINUITY_MARKER_WORLD_ID = ISOLATED_WORLDS.continuityMarker
const POSTCONDITION_WORLD_ID = ISOLATED_WORLDS.postcondition
const RECONCILIATION_WORLD_ID = ISOLATED_WORLDS.reconciliation

/**
 * Counts a read or write action in flight for the workspace until the
 * returned function is called; a write also advances the continuity revision.
 */
export function beginWorkspaceContinuityAction<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string, readOnly: boolean): () => void {
  // A completed write can disappear from the pending map before an older
  // marker read returns. Retain its invalidation across that async interval.
  if (!readOnly) access.setContinuityRevision(access.continuityRevision() + 1)
  const pending = access.continuityActions().get(workspaceId) ?? { reads: 0, writes: 0 }
  access.continuityActions().set(workspaceId, pending)
  const field = readOnly ? 'reads' : 'writes'
  pending[field] += 1
  let finished = false
  return () => {
    if (finished) return
    finished = true
    pending[field] -= 1
    if (!pending.reads && !pending.writes && access.continuityActions().get(workspaceId) === pending) access.continuityActions().delete(workspaceId)
  }
}

/** Continuity evidence for the workspace's active tab, and whether its page is settled. */
function workspaceContinuitySnapshot<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string) {
  const state = access.getMcpGroupState(workspaceId)
  const tab = state.tabs.find(candidate => candidate.id === state.activeTabId) ?? null
  return {
    evidence: access.continuityEvidence().capture({ workspaceId, tab, policy: access.requireMcpTabGroup(workspaceId).navigationPolicy }),
    pageSettled: !!tab && !tab.loading && !tab.sleeping
  }
}

/**
 * Continuity evidence for the workspace's active tab, with the page marker
 * when a selector is given. Evidence is withheld when the workspace changed
 * while the marker was read.
 */
async function currentWorkspaceContinuity<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string, selector: string | undefined) {
  const revision = access.continuityRevision()
  const before = workspaceContinuitySnapshot(access, workspaceId)
  if (selector === undefined || !before.evidence || !before.pageSettled) return before
  const tab = access.getTab(before.evidence.tabId)
  const marker = await readContinuityMarker(() => tab.webContents.executeJavaScriptInIsolatedWorld(
    CONTINUITY_MARKER_WORLD_ID, [{ code: continuityMarkerScript(selector) }], false
  ))
  const after = workspaceContinuitySnapshot(access, workspaceId)
  if (revision !== access.continuityRevision() || compareWorkspaceContinuity({ checkpoint: before.evidence, current: after.evidence, pageSettled: after.pageSettled, priorOutcome: 'NONE' }).status !== 'PASS') {
    return { evidence: null, pageSettled: after.pageSettled }
  }
  const state = access.getMcpGroupState(workspaceId)
  return {
    evidence: access.continuityEvidence().capture({
      workspaceId, tab: state.tabs.find(candidate => candidate.id === state.activeTabId) ?? null,
      policy: access.requireMcpTabGroup(workspaceId).navigationPolicy, marker: { requested: true, value: marker }
    }),
    pageSettled: after.pageSettled
  }
}

/** Forgets the workspace's checkpoint, marker selector and observation generation. */
export function retireWorkspaceContinuity<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string): void {
  access.workspaceContinuity().retire(workspaceId)
  access.continuityMarkers().delete(workspaceId)
  access.workspaceObservationGenerations().delete(workspaceId)
}

/**
 * A fingerprint of the settled target tab and its origin for verifying a
 * write afterwards. It throws when the tab is no longer the workspace's active
 * settled tab or its origin differs from the condition's.
 */
export function postWriteContextFingerprint<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string, tabId: string, condition: BrowserPostcondition): string {
  browserPostconditionScript(condition)
  const snapshot = workspaceContinuitySnapshot(access, workspaceId)
  if (!snapshot.evidence || snapshot.evidence.tabId !== tabId || !snapshot.pageSettled
    || !access.tabBelongsToMcpGroup(workspaceId, tabId)) throw new Error('Post-write verification target is unavailable')
  const tab = access.getTab(tabId)
  let origin: string
  try { origin = new URL(tab.url).origin } catch { throw new Error('Post-write verification target is unavailable') }
  if (origin !== condition.expectedOrigin) throw new Error('Post-write verification origin does not match the target tab')
  return access.continuityEvidence().postWriteFingerprint(snapshot.evidence, condition)
}

/**
 * Reads a post-write condition from the workspace's active tab, while no
 * write is in flight and the workspace's continuity stays unchanged.
 */
export async function readPostWritePostcondition<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string, tabId: string, condition: BrowserPostcondition, validateCurrent: () => void, signal?: AbortSignal): Promise<PostconditionReadResult> {
  validateCurrent()
  const before = workspaceContinuitySnapshot(access, workspaceId)
  if (!before.evidence || !before.pageSettled) return 'unavailable'
  if (before.evidence.tabId !== tabId || !access.tabBelongsToMcpGroup(workspaceId, tabId)) return 'context-changed'
  if (access.continuityActions().get(workspaceId)?.writes) return 'unavailable'
  const revision = access.continuityRevision()
  const tab = access.getTab(tabId)
  const validate = (): void => {
    validateCurrent()
    const after = workspaceContinuitySnapshot(access, workspaceId)
    if (revision !== access.continuityRevision() || access.continuityActions().get(workspaceId)?.writes
      || compareWorkspaceContinuity({ checkpoint: before.evidence, current: after.evidence, pageSettled: after.pageSettled, priorOutcome: 'NONE' }).status !== 'PASS') {
      throw new Error('Browser verification context changed')
    }
  }
  return readBrowserPostcondition({ condition, validateCurrent: validate, signal,
    evaluate: script => tab.webContents.executeJavaScriptInIsolatedWorld(POSTCONDITION_WORLD_ID, [{ code: script }], false)
  })
}

/**
 * Reads reconciliation evidence from the workspace's active tab, while no
 * write is in flight and the workspace's continuity stays unchanged before,
 * during and after the read.
 */
export async function readBrowserReconciliation<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string, tabId: string, condition: BrowserReconciliationCondition,
  validateCurrent: () => void, signal?: AbortSignal): Promise<BrowserReconciliationEvidence> {
  validateCurrent()
  const before = workspaceContinuitySnapshot(access, workspaceId)
  if (!before.evidence || !before.pageSettled) return 'unavailable'
  if (before.evidence.tabId !== tabId || !access.tabBelongsToMcpGroup(workspaceId, tabId)) return 'context-changed'
  if (access.continuityActions().get(workspaceId)?.writes) return 'unavailable'
  const revision = access.continuityRevision()
  const tab = access.getTab(tabId)
  const validate = (): void => {
    validateCurrent()
    const after = workspaceContinuitySnapshot(access, workspaceId)
    if (revision !== access.continuityRevision() || access.continuityActions().get(workspaceId)?.writes
      || compareWorkspaceContinuity({ checkpoint: before.evidence, current: after.evidence, pageSettled: after.pageSettled, priorOutcome: 'NONE' }).status !== 'PASS') {
      throw new Error('Browser reconciliation context changed')
    }
  }
  validate()
  const result = await readContinuityMarker(() => {
    validate()
    return tab.webContents.executeJavaScriptInIsolatedWorld(
      RECONCILIATION_WORLD_ID, [{ code: browserReconciliationScript(condition) }], false
    )
  }, signal)
  validate()
  return result === 'matches' || result === 'missing' || result === 'differs'
    || result === 'precondition-changed' || result === 'context-changed'
    || result === 'ambiguous' ? result : 'unavailable'
}

/**
 * Creates a continuity checkpoint of the workspace's settled page, with an
 * optional page marker, and saves it. A failed save suspends the checkpoint
 * with an unknown outcome.
 */
export async function armWorkspaceContinuity<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string, markerSelector?: string, validateCurrent: () => void = () => undefined): Promise<string> {
  if (access.continuityActions().has(workspaceId)) throw new Error('Wait for pending workspace actions before creating a checkpoint')
  if (markerSelector !== undefined) continuityMarkerScript(markerSelector)
  const revision = access.continuityRevision()
  const { evidence, pageSettled } = await currentWorkspaceContinuity(access, workspaceId, markerSelector)
  if (access.continuityActions().has(workspaceId) || revision !== access.continuityRevision()) throw new Error('Workspace control changed while capturing continuity')
  if (!evidence || !pageSettled) throw new Error('Inspect a settled web page before creating a continuity checkpoint')
  validateCurrent()
  const checkpointId = access.workspaceContinuity().arm(evidence)
  access.setContinuityRevision(access.continuityRevision() + 1)
  if (markerSelector === undefined) access.continuityMarkers().delete(workspaceId)
  else access.continuityMarkers().set(workspaceId, markerSelector)
  try {
    await access.store().save(() => access.persistedState())
  } catch {
    access.workspaceContinuity().suspend(workspaceId, 'OUTCOME_UNKNOWN')
    throw new Error('Could not save the continuity checkpoint; inspect before retrying')
  }
  return checkpointId
}

/**
 * Requires a fresh review before the agent acts again: the workspace's
 * checkpoint, or a new one without evidence when it has none, is suspended
 * with an unknown outcome. When that cannot be saved, the in-memory guard
 * stays and the workspace's agent access is revoked.
 */
export async function requireWorkspaceContinuityReview<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string): Promise<boolean> {
  access.setContinuityRevision(access.continuityRevision() + 1)
  access.requireMcpTabGroup(workspaceId)
  advanceWorkspaceObservationGeneration(access, workspaceId)
  if (access.workspaceContinuity().guardedWorkspaceIds().includes(workspaceId)) access.workspaceContinuity().suspend(workspaceId, 'OUTCOME_UNKNOWN')
  else access.workspaceContinuity().restoreStale(workspaceId)
  try {
    await access.store().save(() => access.persistedState())
    return true
  } catch {
    // Keep the in-memory guard and revoke direct agent access when its durable
    // marker cannot be acknowledged. Recovery remains available to the operator.
    access.updateMcpTabGroup(workspaceId, { agentAccess: false })
    return false
  }
}

/**
 * Starts a new observation generation and suspends the workspace's checkpoint,
 * if it has one, with an unknown outcome while a write is in flight, else the
 * given outcome, else a stale observation while a read is. Returns whether the
 * workspace has a checkpoint.
 */
export function suspendWorkspaceContinuity<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string, outcome: WorkspaceContinuityResult['priorOutcome'] = 'NONE'): boolean {
  access.setContinuityRevision(access.continuityRevision() + 1)
  advanceWorkspaceObservationGeneration(access, workspaceId)
  const pending = access.continuityActions().get(workspaceId)
  access.workspaceContinuity().suspend(workspaceId, pending?.writes ? 'OUTCOME_UNKNOWN' : outcome !== 'NONE' ? outcome : pending?.reads ? 'STALE_OBSERVATION' : 'NONE')
  return access.workspaceContinuity().guardedWorkspaceIds().includes(workspaceId)
}

/**
 * Starts a new observation generation for the workspace's tabs, dropping the
 * observations, recordings, previews and waits of the earlier one.
 */
function advanceWorkspaceObservationGeneration<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string): void {
  access.interruptPwaLifecycle(workspaceId, 'workspace-control-changed')
  const observationGeneration = workspaceObservationGeneration(access, workspaceId) + 1
  access.workspaceObservationGenerations().set(workspaceId, observationGeneration)
  for (const tab of access.tabs()) {
    if (tab.mcpGroupId !== workspaceId) continue
    tab.observationGeneration = observationGeneration
    tab.pendingRuntimeConsoleMessages = []
    tab.inspectorIssues = []
    tab.inspectorIssuesTruncated = false
    tab.authChallenges = []
    tab.authChallengesTruncated = false
    tab.securitySnapshot = undefined
    access.releaseLiveRegion(tab)
    void access.clearCssStatePreview(tab, 'workspace-control-changed').catch(() => undefined)
    access.stopVirtualPasskey(tab, 'authority-changed')
    access.stopLogpoints(tab, 'authority-changed')
    access.rejectNetworkWait(tab.id, 'Workspace control changed while waiting for network activity.')
  }
  access.advanceDownloadObservationGeneration(workspaceId, observationGeneration)
}

/** The workspace's current observation generation; 0 before control first changes. */
export function workspaceObservationGeneration<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string): number {
  return access.workspaceObservationGenerations().get(workspaceId) ?? 0
}

/**
 * Compares the workspace's checkpoint with its page now. An archived
 * workspace has no live page, so its evidence is reported unavailable.
 */
export async function inspectWorkspaceContinuity<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string) {
  // An archive has no live page to review. Preserve its guard and report
  // unavailable evidence until it is opened and inspected afresh.
  if (access.hasArchivedWorkspace(workspaceId)) return access.workspaceContinuity().inspect(workspaceId, null, false)
  const { evidence, pageSettled } = await currentWorkspaceContinuity(access, workspaceId, access.continuityMarkers().get(workspaceId))
  return access.workspaceContinuity().inspect(workspaceId, evidence, pageSettled)
}

/**
 * Resumes the workspace's suspended checkpoint from a current review, once no
 * workspace action is pending and the page still matches what the review saw.
 */
export async function reconcileWorkspaceContinuity<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string, reviewId: string, acknowledgeUnknownOutcome: boolean, validateCurrent: () => void = () => undefined): Promise<void> {
  if (access.continuityActions().has(workspaceId)) throw new Error('Wait for pending workspace actions before reconciling continuity')
  const { evidence, pageSettled } = await currentWorkspaceContinuity(access, workspaceId, access.continuityMarkers().get(workspaceId))
  if (access.continuityActions().has(workspaceId)) throw new Error('Wait for pending workspace actions before reconciling continuity')
  validateCurrent()
  access.workspaceContinuity().reconcile(workspaceId, reviewId, evidence, pageSettled, acknowledgeUnknownOutcome)
}

/** Throws while the workspace's checkpoint must be reviewed before the agent acts. */
export function requireWorkspaceContinuityDispatch<Tab extends WorkspaceContinuityTab>(access: WorkspaceContinuityAccess<Tab>, workspaceId: string): void {
  access.workspaceContinuity().requireDispatch(workspaceId)
}
