import { ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import type { AgentStepHistoryEntry, HronautAgentPresenceApi } from '../../../../shared/agent-presence.js'

export interface AgentStepHistoryTarget {
  clientKey: string
  workspaceId: string
}

/** A step as "All steps" draws it: its picture, when it has one, is always a data URL. */
export type ShownAgentStep = Omit<AgentStepHistoryEntry, 'thumbnail'> & {
  thumbnail?: { width: number; height: number; dataUrl: string }
}

export interface AgentStepHistory {
  steps: Readonly<ShallowRef<ShownAgentStep[]>>
  /** Main has answered for the current agent at least once. */
  loaded: Readonly<Ref<boolean>>
  /** The agent's session closed, or it may no longer work in the workspace; the steps shown are its last. */
  closed: Readonly<Ref<boolean>>
  /** The newest read failed; the steps shown, if any, are from before it. */
  failed: Readonly<Ref<boolean>>
  /** Reads the current agent's steps again. */
  retry: () => void
  dispose: () => void
}

/**
 * Reads one agent's steps while `target` names it, again whenever presence changes. Pictures the shell already has are
 * not sent again. Only the newest read counts, so a late answer never replaces a newer one or another agent's steps.
 */
export function useAgentStepHistory(options: {
  api: Pick<HronautAgentPresenceApi, 'steps'> | undefined
  target: () => AgentStepHistoryTarget | null
  revision: () => number
}): AgentStepHistory {
  const steps = shallowRef<ShownAgentStep[]>([])
  const loaded = ref(false)
  const closed = ref(false)
  const failed = ref(false)
  let pictures = new Map<string, string>()
  let request = 0

  async function read(target: AgentStepHistoryTarget): Promise<void> {
    const current = ++request
    let answer: AgentStepHistoryEntry[] | null
    try {
      answer = await options.api!.steps!({ ...target, known: [...pictures.keys()] })
    } catch {
      if (current === request) failed.value = true
      return
    }
    if (current !== request) return
    failed.value = false
    loaded.value = true
    if (answer === null) {
      closed.value = true
      return
    }
    closed.value = false
    const next = new Map<string, string>()
    steps.value = answer.map(({ thumbnail, ...step }) => {
      const dataUrl = thumbnail?.dataUrl ?? pictures.get(step.id)
      if (!thumbnail || !dataUrl) return step
      next.set(step.id, dataUrl)
      return { ...step, thumbnail: { width: thumbnail.width, height: thumbnail.height, dataUrl } }
    })
    pictures = next
  }

  const targetKey = (): string => {
    const target = options.target()
    return target ? `${target.clientKey}\u0000${target.workspaceId}` : ''
  }
  const stop = watch(
    targetKey,
    (key, previous) => {
      if (key === previous) return
      request += 1
      pictures = new Map()
      steps.value = []
      loaded.value = false
      closed.value = false
      failed.value = false
    },
    { immediate: true, flush: 'sync' }
  )
  const readCurrent = (): void => {
    const target = options.target()
    if (target && options.api?.steps) void read(target)
  }
  const stopReading = watch([targetKey, () => options.revision()], readCurrent, { immediate: true })

  return {
    steps,
    loaded,
    closed,
    failed,
    retry: readCurrent,
    dispose: () => {
      request += 1
      stop()
      stopReading()
    }
  }
}
