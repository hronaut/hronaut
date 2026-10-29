import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { EMPTY_AGENT_PRESENCE, type AgentPresenceSnapshot, type HronautAgentPresenceApi } from '../../../../shared/agent-presence.js'

export interface AgentPresenceSubscription {
  snapshot: Readonly<ShallowRef<AgentPresenceSnapshot>>
  /** Main's presence has arrived at least once; until then the snapshot is only the empty start. */
  loaded: Readonly<Ref<boolean>>
  dispose: () => void
}

/**
 * Mirrors main's agent presence. It subscribes before the first read, and a read or change
 * older than what it already shows is ignored, so a late read never replaces a newer change.
 */
export function useAgentPresence(api: HronautAgentPresenceApi = window.hronautAgentPresence): AgentPresenceSubscription {
  const snapshot = shallowRef<AgentPresenceSnapshot>(EMPTY_AGENT_PRESENCE)
  const loaded = ref(false)
  let disposed = false
  const accept = (next: AgentPresenceSnapshot): void => {
    if (disposed) return
    if (next.revision >= snapshot.value.revision) snapshot.value = next
    loaded.value = true
  }
  const unsubscribe = api.onChanged(accept)
  void api.get().then(accept, () => undefined)
  return {
    snapshot,
    loaded,
    dispose: () => {
      if (disposed) return
      disposed = true
      unsubscribe()
    }
  }
}
