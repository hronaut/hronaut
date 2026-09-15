interface CredentialFillAuthorityState {
  humanInteractionGeneration: number
  lastHumanInteractionAt: number
  lastActiveAt: number
}

export function recordTrustedCredentialFill(
  filled: boolean,
  tab: CredentialFillAuthorityState,
  now: number,
  onUserInteraction?: () => void
): boolean {
  if (!filled) return false
  tab.humanInteractionGeneration += 1
  tab.lastHumanInteractionAt = now
  tab.lastActiveAt = now
  onUserInteraction?.()
  return true
}
