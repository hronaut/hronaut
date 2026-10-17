import { computed, watch } from 'vue'
import type { AgentPresence, HronautAgentPresenceApi } from '../../../shared/agent-presence.js'
import { useAgentPresence } from './useAgentPresence.js'

/** What a workspace group shows of its agents: someone needs you, someone is working, or neither. */
export type WorkspaceGroupActivity = 'needs-you' | 'working' | 'quiet'

export interface WorkspaceGroupAgents {
  /** The agents seen in a workspace, in display order. */
  agents: (workspaceId: string) => readonly AgentPresence[]
  activity: (workspaceId: string) => WorkspaceGroupActivity
  dispose: () => void
}

const NO_AGENTS: readonly AgentPresence[] = []

/**
 * The agents of each workspace group in the tab rail. A group opens by itself when an agent there starts working or
 * starts waiting for you; once the person folds it again, it stays folded until that changes again. The activity
 * present when presence first loads, or when a workspace first appears, is where it starts, so a reload opens nothing.
 */
export function useWorkspaceGroupAgents(options: {
  api: HronautAgentPresenceApi | undefined
  workspaceIds: () => readonly string[]
  needsYou: (workspaceId: string) => boolean
  open: (workspaceId: string) => void
}): WorkspaceGroupAgents {
  const presence = options.api ? useAgentPresence(options.api) : undefined
  const agents = (workspaceId: string): readonly AgentPresence[] => presence?.snapshot.value.workspaces[workspaceId] ?? NO_AGENTS
  const activity = (workspaceId: string): WorkspaceGroupActivity => {
    const present = agents(workspaceId)
    if (options.needsYou(workspaceId) || present.some((agent) => agent.state === 'needs-you')) return 'needs-you'
    return present.some((agent) => agent.state === 'working') ? 'working' : 'quiet'
  }
  const activities = computed(() => new Map(options.workspaceIds().map((workspaceId) => [workspaceId, activity(workspaceId)])))

  let seen: Map<string, WorkspaceGroupActivity> | undefined
  const stop = watch([() => presence?.loaded.value ?? false, activities], ([loaded, next]) => {
    if (!loaded) return
    const previous = seen
    seen = next
    if (!previous) return
    for (const [workspaceId, state] of next) {
      const before = previous.get(workspaceId)
      if (before !== undefined && state !== 'quiet' && state !== before) options.open(workspaceId)
    }
  }, { immediate: true })

  return {
    agents,
    activity,
    dispose: () => {
      stop()
      presence?.dispose()
    }
  }
}
