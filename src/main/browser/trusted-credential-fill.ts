import type { CredentialFillPageResult } from './credential-fill/credential-fill.page.js'

/** Whether a fill script's answer is one the fill gives. */
export function isCredentialFillPageResult(value: unknown): value is CredentialFillPageResult {
  return value === 'none' || value === 'changed' || value === 'filled'
}

interface CredentialFillAuthorityState {
  humanInteractionGeneration: number
  lastHumanInteractionAt: number
  lastActiveAt: number
}

export function recordTrustedCredentialFill(
  outcome: CredentialFillPageResult,
  tab: CredentialFillAuthorityState,
  now: number,
  onUserInteraction?: () => void
): boolean {
  if (outcome === 'none') return false
  tab.humanInteractionGeneration += 1
  tab.lastHumanInteractionAt = now
  tab.lastActiveAt = now
  onUserInteraction?.()
  return outcome === 'filled'
}
