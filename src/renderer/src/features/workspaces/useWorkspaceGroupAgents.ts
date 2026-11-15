import { computed, watch } from 'vue'
import type { AgentPresence, HronautAgentPresenceApi } from '../../../../shared/agent-presence.js'
import { useAgentPresence } from '../agents/useAgentPresence.js'

/** What a workspace group shows of its agents: someone needs you, someone is working, or neither. */
export type WorkspaceGroupActivity = 'needs-you' | 'working' | 'quiet'

/** An agent as a workspace group shows it, without its steps, which change with each call it makes. */
export type WorkspaceGroupAgent = Pick<AgentPresence, 'clientKey' | 'name' | 'initial' | 'colorIndex' | 'state'>

export interface WorkspaceGroupAgents {
  /** The agents seen in a workspace, in display order; the same list while none of them changes what a group shows. */
  agents: (workspaceId: string) => readonly WorkspaceGroupAgent[]
  activity: (workspaceId: string) => WorkspaceGroupActivity
  dispose: () => void
}

/** What decides whether a group opens: whether it needs you, and which agents are there at all. */
interface GroupSighting {
  needsYou: boolean
  present: ReadonlySet<string>
  working: readonly string[]
}

const NO_AGENTS: readonly WorkspaceGroupAgent[] = []

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
  // Presence changes with every call an agent makes, for the step it shows elsewhere. The groups keep their lists while
  // what they show stays equal, so the rail does not draw again for each call.
  const shown = computed<ReadonlyMap<string, readonly WorkspaceGroupAgent[]>>((previous) => {
    const next = new Map<string, readonly WorkspaceGroupAgent[]>()
    let changed = previous === undefined
    for (const [workspaceId, present] of Object.entries(presence?.snapshot.value.workspaces ?? {})) {
      const list = present.map(({ clientKey, name, initial, colorIndex, state }): WorkspaceGroupAgent => ({ clientKey, name, initial, colorIndex, state }))
      const kept = previous?.get(workspaceId)
      const same = kept !== undefined && kept.length === list.length && kept.every((agent, index) => sameAgent(agent, list[index]))
      next.set(workspaceId, same ? kept : list)
      if (!same) changed = true
    }
    return changed || previous === undefined || previous.size !== next.size ? next : previous
  })
  const agents = (workspaceId: string): readonly WorkspaceGroupAgent[] => shown.value.get(workspaceId) ?? NO_AGENTS
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

function sameAgent(left: WorkspaceGroupAgent, right: WorkspaceGroupAgent): boolean {
  return left.clientKey === right.clientKey && left.name === right.name && left.initial === right.initial
    && left.colorIndex === right.colorIndex && left.state === right.state
}
