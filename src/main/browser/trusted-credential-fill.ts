import type { CredentialFillPageResult } from './credential-fill-page.js'

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
