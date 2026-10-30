import { continuityMarkerScript, readContinuityMarker } from '../../../shared/workspace-continuity-marker.js'
import { browserPostconditionScript, type BrowserPostcondition } from '../../../shared/post-write-postcondition.js'
import {
  browserReconciliationScript,
  type BrowserReconciliationCondition,
  type BrowserReconciliationEvidence
} from '../../../shared/browser-reconciliation.js'
import { readBrowserPostcondition, type PostconditionReadResult } from '../../mcp/post-write-browser-read.js'
import { compareWorkspaceContinuity, type WorkspaceContinuityResult } from '../../mcp/workspace-continuity.js'
import { LocalizedError } from '../../localized-error.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { persistedState } from '../browser-state/persisted-state.js'

const CONTINUITY_MARKER_WORLD_ID = ISOLATED_WORLDS.continuityMarker
const POSTCONDITION_WORLD_ID = ISOLATED_WORLDS.postcondition
const RECONCILIATION_WORLD_ID = ISOLATED_WORLDS.reconciliation

/**
 * Counts a read or write action in flight for the workspace until the
 * returned function is called; a write also advances the continuity revision.
 */
export function beginWorkspaceContinuityAction(browser: Browser, workspaceId: string, readOnly: boolean): () => void {
  // A completed write can disappear from the pending map before an older
  // marker read returns. Retain its invalidation across that async interval.
  if (!readOnly) browser.continuityRevision += 1
  const pending = browser.continuityActions.get(workspaceId) ?? { reads: 0, writes: 0 }
  browser.continuityActions.set(workspaceId, pending)
  const field = readOnly ? 'reads' : 'writes'
  pending[field] += 1
  let finished = false
  return () => {
    if (finished) return
    finished = true
    pending[field] -= 1
    if (!pending.reads && !pending.writes && browser.continuityActions.get(workspaceId) === pending) browser.continuityActions.delete(workspaceId)
  }
}

/** Continuity evidence for the workspace's active tab, and whether its page is settled. */
function workspaceContinuitySnapshot(browser: Browser, workspaceId: string) {
  const state = browser.getMcpGroupState(workspaceId)
  const tab = state.tabs.find(candidate => candidate.id === state.activeTabId) ?? null
  return {
    evidence: browser.continuityEvidence.capture({ workspaceId, tab, policy: browser.requireMcpTabGroup(workspaceId).navigationPolicy }),
    pageSettled: !!tab && !tab.loading && !tab.sleeping
  }
}

/**
 * Continuity evidence for the workspace's active tab, with the page marker
 * when a selector is given. Evidence is withheld when the workspace changed
 * while the marker was read.
 */
async function currentWorkspaceContinuity(browser: Browser, workspaceId: string, selector: string | undefined) {
  const revision = browser.continuityRevision
  const before = workspaceContinuitySnapshot(browser, workspaceId)
  if (selector === undefined || !before.evidence || !before.pageSettled) return before
  const tab = getTab(browser, before.evidence.tabId)
  const marker = await readContinuityMarker(() => tab.webContents.executeJavaScriptInIsolatedWorld(
    CONTINUITY_MARKER_WORLD_ID, [{ code: continuityMarkerScript(selector) }], false
  ))
  const after = workspaceContinuitySnapshot(browser, workspaceId)
  if (revision !== browser.continuityRevision || compareWorkspaceContinuity({ checkpoint: before.evidence, current: after.evidence, pageSettled: after.pageSettled, priorOutcome: 'NONE' }).status !== 'PASS') {
    return { evidence: null, pageSettled: after.pageSettled }
  }
  const state = browser.getMcpGroupState(workspaceId)
  return {
    evidence: browser.continuityEvidence.capture({
      workspaceId, tab: state.tabs.find(candidate => candidate.id === state.activeTabId) ?? null,
      policy: browser.requireMcpTabGroup(workspaceId).navigationPolicy, marker: { requested: true, value: marker }
    }),
    pageSettled: after.pageSettled
  }
}

/** Forgets the workspace's checkpoint, marker selector and observation generation. */
export function retireWorkspaceContinuity(browser: Browser, workspaceId: string): void {
  browser.workspaceContinuity.retire(workspaceId)
  browser.continuityMarkers.delete(workspaceId)
  browser.workspaceObservationGenerations.delete(workspaceId)
}

/**
 * A fingerprint of the settled target tab and its origin for verifying a
 * write afterwards. It throws when the tab is no longer the workspace's active
 * settled tab or its origin differs from the condition's.
 */
export function postWriteContextFingerprint(browser: Browser, workspaceId: string, tabId: string, condition: BrowserPostcondition): string {
  browserPostconditionScript(condition)
  const snapshot = workspaceContinuitySnapshot(browser, workspaceId)
  if (!snapshot.evidence || snapshot.evidence.tabId !== tabId || !snapshot.pageSettled
    || !browser.tabBelongsToMcpGroup(workspaceId, tabId)) throw new Error('Post-write verification target is unavailable')
  const tab = getTab(browser, tabId)
  let origin: string
  try { origin = new URL(tab.url).origin } catch { throw new Error('Post-write verification target is unavailable') }
  if (origin !== condition.expectedOrigin) throw new Error('Post-write verification origin does not match the target tab')
  return browser.continuityEvidence.postWriteFingerprint(snapshot.evidence, condition)
}

/**
 * Reads a post-write condition from the workspace's active tab, while no
 * write is in flight and the workspace's continuity stays unchanged.
 */
export async function readPostWritePostcondition(browser: Browser, workspaceId: string, tabId: string, condition: BrowserPostcondition, validateCurrent: () => void, signal?: AbortSignal): Promise<PostconditionReadResult> {
  validateCurrent()
  const before = workspaceContinuitySnapshot(browser, workspaceId)
  if (!before.evidence || !before.pageSettled) return 'unavailable'
  if (before.evidence.tabId !== tabId || !browser.tabBelongsToMcpGroup(workspaceId, tabId)) return 'context-changed'
  if (browser.continuityActions.get(workspaceId)?.writes) return 'unavailable'
  const revision = browser.continuityRevision
  const tab = getTab(browser, tabId)
  const validate = (): void => {
    validateCurrent()
    const after = workspaceContinuitySnapshot(browser, workspaceId)
    if (revision !== browser.continuityRevision || browser.continuityActions.get(workspaceId)?.writes
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
export async function readBrowserReconciliation(browser: Browser, workspaceId: string, tabId: string, condition: BrowserReconciliationCondition,
  validateCurrent: () => void, signal?: AbortSignal): Promise<BrowserReconciliationEvidence> {
  validateCurrent()
  const before = workspaceContinuitySnapshot(browser, workspaceId)
  if (!before.evidence || !before.pageSettled) return 'unavailable'
  if (before.evidence.tabId !== tabId || !browser.tabBelongsToMcpGroup(workspaceId, tabId)) return 'context-changed'
  if (browser.continuityActions.get(workspaceId)?.writes) return 'unavailable'
  const revision = browser.continuityRevision
  const tab = getTab(browser, tabId)
  const validate = (): void => {
    validateCurrent()
    const after = workspaceContinuitySnapshot(browser, workspaceId)
    if (revision !== browser.continuityRevision || browser.continuityActions.get(workspaceId)?.writes
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
export async function armWorkspaceContinuity(browser: Browser, workspaceId: string, markerSelector?: string, validateCurrent: () => void = () => undefined): Promise<string> {
  if (browser.continuityActions.has(workspaceId)) throw new LocalizedError('appErrors.continuity.checkpointPending')
  if (markerSelector !== undefined) continuityMarkerScript(markerSelector)
  const revision = browser.continuityRevision
  const { evidence, pageSettled } = await currentWorkspaceContinuity(browser, workspaceId, markerSelector)
  if (browser.continuityActions.has(workspaceId) || revision !== browser.continuityRevision) throw new LocalizedError('appErrors.continuity.controlChanged')
  if (!evidence || !pageSettled) throw new LocalizedError('appErrors.continuity.pageUnsettled')
  validateCurrent()
  const checkpointId = browser.workspaceContinuity.arm(evidence)
  browser.continuityRevision += 1
  if (markerSelector === undefined) browser.continuityMarkers.delete(workspaceId)
  else browser.continuityMarkers.set(workspaceId, markerSelector)
  try {
    await browser.store.save(() => persistedState(browser))
  } catch {
    browser.workspaceContinuity.suspend(workspaceId, 'OUTCOME_UNKNOWN')
    throw new LocalizedError('appErrors.continuity.saveFailed')
  }
  return checkpointId
}

/**
 * Requires a fresh review before the agent acts again: the workspace's
 * checkpoint, or a new one without evidence when it has none, is suspended
 * with an unknown outcome. When that cannot be saved, the in-memory guard
 * stays and the workspace's agent access is revoked.
 */
export async function requireWorkspaceContinuityReview(browser: Browser, workspaceId: string): Promise<boolean> {
  browser.continuityRevision += 1
  browser.requireMcpTabGroup(workspaceId)
  advanceWorkspaceObservationGeneration(browser, workspaceId)
  if (browser.workspaceContinuity.guardedWorkspaceIds().includes(workspaceId)) browser.workspaceContinuity.suspend(workspaceId, 'OUTCOME_UNKNOWN')
  else browser.workspaceContinuity.restoreStale(workspaceId)
  try {
    await browser.store.save(() => persistedState(browser))
    return true
  } catch {
    // Keep the in-memory guard and revoke direct agent access when its durable
    // marker cannot be acknowledged. Recovery remains available to the operator.
    browser.updateMcpTabGroup(workspaceId, { agentAccess: false })
    return false
  }
}

/**
 * Starts a new observation generation and suspends the workspace's checkpoint,
 * if it has one, with an unknown outcome while a write is in flight, else the
 * given outcome, else a stale observation while a read is. Returns whether the
 * workspace has a checkpoint.
 */
export function suspendWorkspaceContinuity(browser: Browser, workspaceId: string, outcome: WorkspaceContinuityResult['priorOutcome'] = 'NONE'): boolean {
  browser.continuityRevision += 1
  advanceWorkspaceObservationGeneration(browser, workspaceId)
  const pending = browser.continuityActions.get(workspaceId)
  browser.workspaceContinuity.suspend(workspaceId, pending?.writes ? 'OUTCOME_UNKNOWN' : outcome !== 'NONE' ? outcome : pending?.reads ? 'STALE_OBSERVATION' : 'NONE')
  return browser.workspaceContinuity.guardedWorkspaceIds().includes(workspaceId)
}

/**
 * Starts a new observation generation for the workspace's tabs, dropping the
 * observations, recordings, previews and waits of the earlier one.
 */
function advanceWorkspaceObservationGeneration(browser: Browser, workspaceId: string): void {
  browser.pwaLifecycleRecorder.interruptWorkspace(workspaceId, 'workspace-control-changed')
  const observationGeneration = workspaceObservationGeneration(browser, workspaceId) + 1
  browser.workspaceObservationGenerations.set(workspaceId, observationGeneration)
  for (const tab of browser.tabs.values()) {
    if (tab.mcpGroupId !== workspaceId) continue
    tab.observationGeneration = observationGeneration
    tab.pendingRuntimeConsoleMessages = []
    tab.inspectorIssues = []
    tab.inspectorIssuesTruncated = false
    tab.authChallenges = []
    tab.authChallengesTruncated = false
    tab.securitySnapshot = undefined
    browser.liveRegionRecorder.release(tab)
    void browser.cssStatePreview.clear(tab, 'workspace-control-changed').catch(() => undefined)
    browser.virtualPasskeys.stop(tab, 'authority-changed')
    browser.logpoints.stop(tab, 'authority-changed')
    browser.networkWaitController.reject(tab.id, 'Workspace control changed while waiting for network activity.')
  }
  browser.downloadController.advanceWorkspaceObservationGeneration(workspaceId, observationGeneration)
}

/** The workspace's current observation generation; 0 before control first changes. */
export function workspaceObservationGeneration(browser: Browser, workspaceId: string): number {
  return browser.workspaceObservationGenerations.get(workspaceId) ?? 0
}

/**
 * Compares the workspace's checkpoint with its page now. An archived
 * workspace has no live page, so its evidence is reported unavailable.
 */
export async function inspectWorkspaceContinuity(browser: Browser, workspaceId: string) {
  // An archive has no live page to review. Preserve its guard and report
  // unavailable evidence until it is opened and inspected afresh.
  if (browser.savedTabGroups.has(workspaceId)) return browser.workspaceContinuity.inspect(workspaceId, null, false)
  const { evidence, pageSettled } = await currentWorkspaceContinuity(browser, workspaceId, browser.continuityMarkers.get(workspaceId))
  return browser.workspaceContinuity.inspect(workspaceId, evidence, pageSettled)
}

/**
 * Resumes the workspace's suspended checkpoint from a current review, once no
 * workspace action is pending and the page still matches what the review saw.
 */
export async function reconcileWorkspaceContinuity(browser: Browser, workspaceId: string, reviewId: string, acknowledgeUnknownOutcome: boolean, validateCurrent: () => void = () => undefined): Promise<void> {
  if (browser.continuityActions.has(workspaceId)) throw new LocalizedError('appErrors.continuity.reconcilePending')
  const { evidence, pageSettled } = await currentWorkspaceContinuity(browser, workspaceId, browser.continuityMarkers.get(workspaceId))
  if (browser.continuityActions.has(workspaceId)) throw new LocalizedError('appErrors.continuity.reconcilePending')
  validateCurrent()
  browser.workspaceContinuity.reconcile(workspaceId, reviewId, evidence, pageSettled, acknowledgeUnknownOutcome)
}

/** Throws while the workspace's checkpoint must be reviewed before the agent acts. */
export function requireWorkspaceContinuityDispatch(browser: Browser, workspaceId: string): void {
  browser.workspaceContinuity.requireDispatch(workspaceId)
}
