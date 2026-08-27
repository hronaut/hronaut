import { computed, ref } from 'vue'
import type { HronautLicenseApi, CommercialLicenseState } from '../../../shared/types.js'

type CommercialLicenseAction = 'idle' | 'activating' | 'refreshing' | 'deactivating'

export interface CommercialLicenseControllerOptions {
  api: HronautLicenseApi
  confirmDeactivate: () => boolean
  emptyKeyMessage: () => string
  formatError: (error: unknown) => string
}

export function useCommercialLicenseController(options: CommercialLicenseControllerOptions) {
  const state = ref<CommercialLicenseState>({
    status: 'not-activated',
    active: false,
    secureStorageAvailable: false
  })
  const keyDraft = ref('')
  const action = ref<CommercialLicenseAction>('idle')
  const errorMessage = ref('')
  let generation = 0
  let revision = 0
  let initializePromise: Promise<void> | null = null
  let unsubscribe: (() => void) | null = null

  const busy = computed(() => action.value !== 'idle')
  const stateMessage = computed(() => (
    state.value.message && state.value.message !== errorMessage.value ? state.value.message : ''
  ))

  function accept(next: CommercialLicenseState): void {
    revision += 1
    state.value = next
    errorMessage.value = ''
  }

  function detachListener(): void {
    const current = unsubscribe
    unsubscribe = null
    current?.()
  }

  function initialize(): Promise<void> {
    if (initializePromise) return initializePromise
    const currentGeneration = ++generation
    const initialRevision = revision
    detachListener()
    unsubscribe = options.api.onChanged((next) => {
      if (generation === currentGeneration) accept(next)
    })
    initializePromise = options.api.getState()
      .then((next) => {
        if (generation === currentGeneration && revision === initialRevision) accept(next)
      })
      .catch((error: unknown) => {
        if (generation !== currentGeneration) return
        const failures = [error]
        try {
          detachListener()
        } catch (cleanupError) {
          failures.push(cleanupError)
        }
        try {
          errorMessage.value = options.formatError(error)
        } catch (reportingError) {
          failures.push(reportingError)
        }
        if (failures.length === 1) throw error
        throw new AggregateError(failures, 'License initialization failed and listener cleanup was incomplete')
      })
      .finally(() => {
        if (generation === currentGeneration) initializePromise = null
      })
    return initializePromise
  }

  async function run(
    nextAction: Exclude<CommercialLicenseAction, 'idle'>,
    operation: () => Promise<CommercialLicenseState>
  ): Promise<boolean> {
    if (busy.value) return false
    const operationGeneration = generation
    const startingRevision = revision
    action.value = nextAction
    errorMessage.value = ''
    try {
      const next = await operation()
      if (operationGeneration !== generation) return false
      if (revision === startingRevision) accept(next)
      return true
    } catch (error) {
      if (operationGeneration === generation) errorMessage.value = options.formatError(error)
      return false
    } finally {
      if (operationGeneration === generation) action.value = 'idle'
    }
  }

  async function activate(): Promise<boolean> {
    const key = keyDraft.value.trim()
    if (!key) {
      errorMessage.value = options.emptyKeyMessage()
      return false
    }
    const activated = await run('activating', () => options.api.activate(key))
    if (activated) keyDraft.value = ''
    return activated
  }

  function refresh(): Promise<boolean> {
    return run('refreshing', () => options.api.refresh())
  }

  function deactivate(): Promise<boolean> {
    if (busy.value || !options.confirmDeactivate()) return Promise.resolve(false)
    return run('deactivating', () => options.api.deactivate())
  }

  function dispose(): void {
    generation += 1
    initializePromise = null
    action.value = 'idle'
    detachListener()
  }

  return {
    state,
    keyDraft,
    action,
    busy,
    errorMessage,
    stateMessage,
    initialize,
    accept,
    activate,
    refresh,
    deactivate,
    dispose
  }
}

export type CommercialLicenseController = ReturnType<typeof useCommercialLicenseController>
