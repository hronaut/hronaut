import { shallowRef, type ShallowRef } from 'vue'
import { EMPTY_AGENT_PRESENCE, type AgentPresenceSnapshot, type HronautAgentPresenceApi } from '../../../shared/agent-presence.js'

export interface AgentPresenceSubscription {
  snapshot: Readonly<ShallowRef<AgentPresenceSnapshot>>
  dispose: () => void
}

/**
 * Mirrors main's agent presence. It subscribes before the first read, and a read or change
 * older than what it already shows is ignored, so a late read never replaces a newer change.
 */
export function useAgentPresence(api: HronautAgentPresenceApi = window.hronautAgentPresence): AgentPresenceSubscription {
  const snapshot = shallowRef<AgentPresenceSnapshot>(EMPTY_AGENT_PRESENCE)
  let disposed = false
  const accept = (next: AgentPresenceSnapshot): void => {
    if (!disposed && next.revision >= snapshot.value.revision) snapshot.value = next
  }
  const unsubscribe = api.onChanged(accept)
  void api.get().then(accept, () => undefined)
  return {
    snapshot,
    dispose: () => {
      if (disposed) return
      disposed = true
      unsubscribe()
    }
  }
}
