import { computed, ref, type Ref } from 'vue'
import type { HronautMcpApi, McpControlState } from '../../../shared/types.js'

export interface McpStatusControllerOptions {
  api: HronautMcpApi
  endpoint: Readonly<Ref<string>>
  copyText: (text: string) => Promise<boolean>
  onPauseError: (error: unknown) => void
}

export function useMcpStatusController(options: McpStatusControllerOptions) {
  const state = ref<McpControlState>({ status: 'starting', paused: false })
  const copied = ref(false)
  const pauseBusy = ref(false)
  let generation = 0
  let revision = 0
  let copySequence = 0
  let initializePromise: Promise<void> | null = null
  let unsubscribe: (() => void) | null = null
  let copiedTimer: number | undefined

  const canTogglePaused = computed(() => (
    !pauseBusy.value
    && (state.value.status === 'ready' || state.value.status === 'paused')
  ))

  function accept(next: McpControlState): void {
    revision += 1
    state.value = next
  }

  function initialize(): Promise<void> {
    if (initializePromise) return initializePromise
    const currentGeneration = ++generation
    const initialRevision = revision
    unsubscribe?.()
    unsubscribe = options.api.onChanged((next) => {
      if (generation === currentGeneration) accept(next)
    })
    initializePromise = options.api.getState()
      .then((next) => {
        if (generation === currentGeneration && revision === initialRevision) accept(next)
      })
      .catch((error: unknown) => {
        if (generation !== currentGeneration) return
        unsubscribe?.()
        unsubscribe = null
        options.onPauseError(error)
        throw error
      })
      .finally(() => {
        if (generation === currentGeneration) initializePromise = null
      })
    return initializePromise
  }

  async function copyEndpoint(): Promise<boolean> {
    const endpoint = options.endpoint.value
    const operationGeneration = generation
    const sequence = ++copySequence
    if (!await options.copyText(endpoint)) return false
    if (
      operationGeneration !== generation
      || sequence !== copySequence
      || options.endpoint.value !== endpoint
    ) return false
    copied.value = true
    if (copiedTimer !== undefined) window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => {
      copied.value = false
      copiedTimer = undefined
    }, 1_500)
    return true
  }

  async function togglePaused(): Promise<boolean> {
    if (!canTogglePaused.value) return false
    const operationGeneration = generation
    const startingRevision = revision
    const nextPaused = !state.value.paused
    pauseBusy.value = true
    try {
      const next = await options.api.setPaused(nextPaused)
      if (operationGeneration !== generation) return false
      if (revision === startingRevision) accept(next)
      return true
    } catch (error) {
      if (operationGeneration === generation) options.onPauseError(error)
      return false
    } finally {
      if (operationGeneration === generation) pauseBusy.value = false
    }
  }

  function dispose(): void {
    generation += 1
    copySequence += 1
    unsubscribe?.()
    unsubscribe = null
    initializePromise = null
    pauseBusy.value = false
    if (copiedTimer !== undefined) window.clearTimeout(copiedTimer)
    copiedTimer = undefined
    copied.value = false
  }

  return {
    endpoint: options.endpoint,
    state,
    copied,
    pauseBusy,
    canTogglePaused,
    initialize,
    accept,
    copyEndpoint,
    togglePaused,
    dispose
  }
}

export type McpStatusController = ReturnType<typeof useMcpStatusController>
