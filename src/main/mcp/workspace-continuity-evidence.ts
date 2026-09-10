import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { BrowserWorkspaceNavigationPolicy } from '../../shared/types.js'
import type { BrowserPostcondition } from '../../shared/post-write-postcondition.js'
import type { WorkspaceContinuityEvidence } from './workspace-continuity.js'

/** Fingerprints are private, process-local continuity signals, not account proof.
 * Restart creates a new epoch and key; old runtime evidence cannot match. */
export class WorkspaceContinuityEvidenceFactory {
  private readonly key = randomBytes(32)
  private readonly epoch = randomUUID()

  private digest(domain: string, value: unknown): string {
    return createHmac('sha256', this.key).update(JSON.stringify([domain, value])).digest('hex')
  }

  postWriteFingerprint(evidence: WorkspaceContinuityEvidence, condition: BrowserPostcondition): string {
    return this.digest('post-write', [
      evidence.epoch, evidence.workspaceId, evidence.tabId,
      evidence.originDigest, evidence.policyDigest, condition
    ])
  }

  capture(input: {
    workspaceId: string
    tab: { id: string; url: string; navigationGeneration: number; humanInteractionGeneration?: number } | null
    policy: BrowserWorkspaceNavigationPolicy
    marker?: { requested: true; value: string | null }
  }): WorkspaceContinuityEvidence | null {
    const { tab, policy, marker } = input
    if (!tab || !input.workspaceId || input.workspaceId.length > 128 || !tab.id || tab.id.length > 128) return null
    if (![tab.navigationGeneration, tab.humanInteractionGeneration].every(value => Number.isSafeInteger(value) && Number(value) >= 0)) return null
    if (policy.mode !== 'unrestricted' && policy.mode !== 'restricted') return null
    if (!Array.isArray(policy.rules) || policy.rules.length > 1000 || policy.rules.some(rule => typeof rule !== 'string' || rule.length > 2048)) return null
    let origin: string
    try {
      if (tab.url.length > 65536) return null
      const url = new URL(tab.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
      origin = url.origin
    } catch { return null }
    if (marker && (typeof marker.value !== 'string' || Buffer.byteLength(marker.value, 'utf8') > 512)) return null
    return {
      epoch: this.epoch,
      workspaceId: input.workspaceId,
      tabId: tab.id,
      originDigest: this.digest('origin', origin),
      // Sorting ignores irrelevant rule ordering while preserving every rule.
      policyDigest: this.digest('policy', [policy.mode, [...new Set(policy.rules)].sort()]),
      navigationGeneration: tab.navigationGeneration,
      humanInteractionGeneration: tab.humanInteractionGeneration!,
      ...(marker ? { markerDigest: this.digest('marker', marker.value) } : {})
    }
  }
}
