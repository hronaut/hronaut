export interface MutableMcpRuntimeCandidate {
  setPaused(paused: boolean): void
  setAuthenticationToken(token: string | undefined): void
}

export interface McpRuntimeCutoverState {
  paused: boolean
  authenticationToken: string | undefined
}

export function stageMcpRuntimeCandidate(candidate: MutableMcpRuntimeCandidate): void {
  // A replacement listener becomes reachable as soon as start() resolves, but
  // settings persistence still has to succeed before it may become active.
  // Keep it closed throughout that staging window regardless of the current
  // runtime state; cutover applies the latest state synchronously.
  candidate.setPaused(true)
}

export function synchronizeMcpRuntimeCandidate(
  candidate: MutableMcpRuntimeCandidate,
  currentState: () => McpRuntimeCutoverState
): void {
  const state = currentState()
  // The candidate is already paused, so authentication can be updated without
  // briefly exposing it under the old policy. Apply pause last in case the
  // latest state intentionally resumes the listener at cutover.
  candidate.setAuthenticationToken(state.authenticationToken)
  candidate.setPaused(state.paused)
}
