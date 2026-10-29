import { computed, watch } from 'vue'
import type { AgentPresence, HronautAgentPresenceApi } from '../../../../shared/agent-presence.js'
import { useAgentPresence } from '../agents/useAgentPresence.js'

/** What a workspace group shows of its agents: someone needs you, someone is working, or neither. */
export type WorkspaceGroupActivity = 'needs-you' | 'working' | 'quiet'

export interface WorkspaceGroupAgents {
  /** The agents seen in a workspace, in display order. */
  agents: (workspaceId: string) => readonly AgentPresence[]
  activity: (workspaceId: string) => WorkspaceGroupActivity
  dispose: () => void
}

/** What decides whether a group opens: whether it needs you, and which agents are there at all. */
interface GroupSighting {
  needsYou: boolean
  present: ReadonlySet<string>
  working: readonly string[]
}

const NO_AGENTS: readonly AgentPresence[] = []

/**
 * The agents of each workspace group in the tab rail. A group opens by itself when an agent starts working there, one
 * that was not there before, or when the workspace starts waiting for you. An agent pausing between its own steps, or a
 * request for you ending while it carries on, opens nothing, so a group the person folds stays folded while the same
 * agents work in it. What presence shows when it first loads, or when a workspace first appears, is where it starts,
 * so a reload opens nothing.
 */
export function useWorkspaceGroupAgents(options: {
  api: HronautAgentPresenceApi | undefined
  workspaceIds: () => readonly string[]
  needsYou: (workspaceId: string) => boolean
  open: (workspaceId: string) => void
}): WorkspaceGroupAgents {
  const presence = options.api ? useAgentPresence(options.api) : undefined
  const agents = (workspaceId: string): readonly AgentPresence[] => presence?.snapshot.value.workspaces[workspaceId] ?? NO_AGENTS
  const needsYou = (workspaceId: string): boolean => options.needsYou(workspaceId) || agents(workspaceId).some((agent) => agent.state === 'needs-you')
  const activity = (workspaceId: string): WorkspaceGroupActivity => {
    if (needsYou(workspaceId)) return 'needs-you'
    return agents(workspaceId).some((agent) => agent.state === 'working') ? 'working' : 'quiet'
  }
  const sightings = computed(() => new Map(options.workspaceIds().map((workspaceId): [string, GroupSighting] => {
    const present = agents(workspaceId)
    return [workspaceId, {
      needsYou: needsYou(workspaceId),
      present: new Set(present.map((agent) => agent.clientKey)),
      working: present.filter((agent) => agent.state === 'working').map((agent) => agent.clientKey)
    }]
  })))

  let seen: Map<string, GroupSighting> | undefined
  const stop = watch([() => presence?.loaded.value ?? false, sightings], ([loaded, next]) => {
    if (!loaded) return
    const previous = seen
    seen = next
    if (!previous) return
    for (const [workspaceId, sighting] of next) {
      const before = previous.get(workspaceId)
      if (!before) continue
      if ((sighting.needsYou && !before.needsYou) || sighting.working.some((clientKey) => !before.present.has(clientKey))) {
        options.open(workspaceId)
      }
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
