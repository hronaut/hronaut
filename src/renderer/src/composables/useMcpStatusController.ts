import { computed, ref, watch, type Ref } from 'vue'
import type { CopyTextWithFeedback } from './useShellFeedbackController.js'
import type { HronautMcpApi, McpControlState, McpPortMoveResult } from '../../../shared/types.js'

export interface McpStatusControllerOptions {
  api: HronautMcpApi
  endpoint: Readonly<Ref<string>>
  copyText: CopyTextWithFeedback
  onPauseError: (error: unknown) => void
}

export function useMcpStatusController(options: McpStatusControllerOptions) {
  const summaryOpen = ref(false)
  const state = ref<McpControlState>({ status: 'starting', paused: false })
  const copied = ref(false)
  const refreshFailed = ref(false)
  const pauseBusy = ref(false)
  const portBusy = ref(false)
  /** The last move to the offered port that did not happen: the port was taken meanwhile, or the move failed. */
  const portFailed = ref<{ outcome: 'taken' | 'failed'; port: number } | null>(null)
  let generation = 0
  let listenerGeneration = 0
  let revision = 0
  let copySequence = 0
  let refreshSequence = 0
  let initializePromise: Promise<void> | null = null
  let unsubscribe: (() => void) | null = null
  let copiedTimer: number | undefined

  const canTogglePaused = computed(() => (
    !pauseBusy.value
    && (state.value.status === 'ready' || state.value.status === 'paused')
  ))

  function accept(next: McpControlState): void {
    refreshFailed.value = false
    revision += 1
    state.value = next
  }

  function detachListener(): void {
    const current = unsubscribe
    unsubscribe = null
    current?.()
  }

  function initialize(): Promise<void> {
    if (initializePromise) return initializePromise
    const currentGeneration = generation
    const currentListenerGeneration = ++listenerGeneration
    const initialRevision = revision
    detachListener()
    unsubscribe = options.api.onChanged((next) => {
      if (generation === currentGeneration && listenerGeneration === currentListenerGeneration) accept(next)
    })
    initializePromise = options.api.getState()
      .then((next) => {
        if (
          generation === currentGeneration
          && listenerGeneration === currentListenerGeneration
          && revision === initialRevision
        ) accept(next)
      })
      .catch((error: unknown) => {
        if (generation !== currentGeneration || listenerGeneration !== currentListenerGeneration) return
        // Make a listener inert before native cleanup. If unsubscribe throws,
        // its callback may still be live and must not publish stale MCP state.
        listenerGeneration += 1
        initializePromise = null
        const failures = [error]
        try {
          detachListener()
        } catch (cleanupError) {
          failures.push(cleanupError)
        }
        try {
          options.onPauseError(error)
        } catch (reportingError) {
          failures.push(reportingError)
        }
        if (failures.length === 1) throw error
        throw new AggregateError(failures, 'MCP initialization failed and listener cleanup was incomplete')
      })
      .finally(() => {
        if (
          generation === currentGeneration
          && listenerGeneration === currentListenerGeneration
        ) initializePromise = null
      })
    return initializePromise
  }

  function clearCopiedFeedback(): void {
    if (copiedTimer !== undefined) window.clearTimeout(copiedTimer)
    copiedTimer = undefined
    copied.value = false
  }

  async function copyEndpoint(): Promise<boolean> {
    const endpoint = options.endpoint.value
    const operationGeneration = generation
    const sequence = ++copySequence
    clearCopiedFeedback()
    const ownsFeedback = (): boolean => (
      operationGeneration === generation
      && sequence === copySequence
      && options.endpoint.value === endpoint
    )
    if (!await options.copyText(endpoint, ownsFeedback) || !ownsFeedback()) return false
    copied.value = true
    if (copiedTimer !== undefined) window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => {
      copied.value = false
      copiedTimer = undefined
    }, 1_500)
    return true
  }

  async function refresh(): Promise<void> {
    const sequence = ++refreshSequence
    const expectedGeneration = generation
    const expectedRevision = revision
    try {
      const next = await options.api.getState()
      if (sequence === refreshSequence && generation === expectedGeneration && revision === expectedRevision) accept(next)
    } catch {
      if (sequence === refreshSequence && generation === expectedGeneration && revision === expectedRevision) {
        // A failed refresh must not display cached client evidence as current.
        accept({ ...state.value, readiness: undefined })
        refreshFailed.value = true
      }
    }
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

  /** Moves the listener to the free port main suggested after the configured one failed; null when nothing was tried. */
  async function moveToSuggestedPort(): Promise<McpPortMoveResult | null> {
    const port = state.value.suggestedPort
    if (portBusy.value || state.value.status !== 'error' || !port) return null
    const operationGeneration = generation
    const startingRevision = revision
    portBusy.value = true
    portFailed.value = null
    try {
      const { result, state: next } = await options.api.moveToSuggestedPort(port)
      if (operationGeneration !== generation) return null
      if (revision === startingRevision) accept(next)
      if (result.outcome === 'taken' || result.outcome === 'failed') portFailed.value = { outcome: result.outcome, port: result.port }
      return result
    } catch {
      if (operationGeneration !== generation) return null
      portFailed.value = { outcome: 'failed', port }
      return { outcome: 'failed', port }
    } finally {
      if (operationGeneration === generation) portBusy.value = false
    }
  }

  const stopEndpointTracking = watch(options.endpoint, () => {
    copySequence += 1
    clearCopiedFeedback()
  }, { flush: 'sync' })

  function dispose(): void {
    stopEndpointTracking()
    summaryOpen.value = false
    generation += 1
    listenerGeneration += 1
    copySequence += 1
    initializePromise = null
    pauseBusy.value = false
    portBusy.value = false
    clearCopiedFeedback()
    detachListener()
  }

  return {
    endpoint: options.endpoint,
    state,
    copied,
    refreshFailed,
    pauseBusy,
    portBusy,
    portFailed,
    canTogglePaused,
    initialize,
    refresh,
    summaryOpen,
    accept,
    copyEndpoint,
    togglePaused,
    moveToSuggestedPort,
    dispose
  }
}

export type McpStatusController = ReturnType<typeof useMcpStatusController>

/** What the rail's MCP pill and pause button read and do. */
export type McpStatusControlsController = Pick<McpStatusController,
  | 'endpoint' | 'state' | 'copied' | 'refreshFailed' | 'pauseBusy' | 'portBusy' | 'portFailed' | 'canTogglePaused'
  | 'summaryOpen' | 'refresh' | 'copyEndpoint' | 'togglePaused' | 'moveToSuggestedPort'>
