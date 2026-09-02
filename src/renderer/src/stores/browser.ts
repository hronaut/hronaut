import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  BrowserState,
  NavigateOptions,
  NewTabOptions
} from '../../../shared/types.js'

export function emptyBrowserState(): BrowserState {
  return {
    tabs: [],
    closedTabs: [],
    activeTabId: null,
    allHumanInteractionLocked: false,
    mcpUrl: '',
    profilePath: '',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

export const useBrowserStore = defineStore('browser', () => {
  const state = ref<BrowserState>(emptyBrowserState())
  const initialized = ref(false)
  const initializing = ref(false)
  const initializationError = ref<unknown>(null)
  const activeTab = computed(() => state.value.tabs.find((tab) => tab.id === state.value.activeTabId))
  const activeWorkspace = computed(() => {
    const activeWorkspaceId = activeTab.value?.mcpGroupId
    return state.value.mcpTabGroups.find((workspace) => workspace.id === activeWorkspaceId)
  })

  let generation = 0
  let revision = 0
  let operationSequence = 0
  const pendingOperations = new Set<number>()
  const completedOperations = new Map<number, {
    generation: number
    startingRevision: number
    state: BrowserState
  }>()
  let initializePromise: Promise<void> | null = null
  let unsubscribe: (() => void) | null = null

  function acceptAuthoritativeState(next: BrowserState): void {
    revision += 1
    state.value = next
  }

  function detachListener(): void {
    const current = unsubscribe
    unsubscribe = null
    current?.()
  }

  async function initialize(): Promise<void> {
    if (initialized.value) return
    if (initializePromise) return initializePromise
    const currentGeneration = ++generation
    initializing.value = true
    initializationError.value = null
    const initialRevision = revision
    unsubscribe = window.hronaut.onStateChanged((next) => {
      if (generation === currentGeneration) acceptAuthoritativeState(next)
    })
    initializePromise = window.hronaut.getState()
      .then((next) => {
        if (generation !== currentGeneration) return
        if (revision === initialRevision) acceptAuthoritativeState(next)
        initialized.value = true
      })
      .catch((error: unknown) => {
        if (generation !== currentGeneration) return
        // Invalidate the callback before native cleanup. An unsubscribe
        // failure can leave the callback alive, but it must stay inert.
        generation += 1
        initializePromise = null
        initializing.value = false
        initializationError.value = error
        initialized.value = false
        const failures = [error]
        try {
          detachListener()
        } catch (cleanupError) {
          failures.push(cleanupError)
        }
        if (failures.length === 1) throw error
        throw new AggregateError(failures, 'Browser initialization failed and listener cleanup was incomplete')
      })
      .finally(() => {
        if (generation === currentGeneration) {
          initializePromise = null
          initializing.value = false
        }
      })
    return initializePromise
  }

  function dispose(): void {
    generation += 1
    pendingOperations.clear()
    completedOperations.clear()
    initializePromise = null
    initialized.value = false
    initializing.value = false
    detachListener()
  }

  function reconcileOperations(): void {
    for (const [sequence, result] of completedOperations) {
      if (result.generation !== generation || result.startingRevision !== revision) {
        completedOperations.delete(sequence)
      }
    }
    const newestCompleted = [...completedOperations.entries()]
      .sort(([left], [right]) => right - left)[0]
    if (!newestCompleted) return
    const [sequence, result] = newestCompleted
    if ([...pendingOperations].some((pendingSequence) => pendingSequence > sequence)) return
    completedOperations.clear()
    acceptAuthoritativeState(result.state)
  }

  async function syncOperation(operation: Promise<BrowserState>): Promise<BrowserState> {
    const currentGeneration = generation
    const startingRevision = revision
    const sequence = ++operationSequence
    pendingOperations.add(sequence)
    try {
      const next = await operation
      if (generation === currentGeneration && revision === startingRevision) {
        completedOperations.set(sequence, {
          generation: currentGeneration,
          startingRevision,
          state: next
        })
      }
      return next
    } finally {
      pendingOperations.delete(sequence)
      reconcileOperations()
    }
  }

  const refresh = (): Promise<BrowserState> => syncOperation(window.hronaut.getState())
  const openHome = (): Promise<BrowserState> => syncOperation(window.hronaut.openHome())
  const newTab = (options?: NewTabOptions): Promise<BrowserState> => syncOperation(window.hronaut.newTab(options))
  const selectTab = (tabId: string): Promise<BrowserState> => syncOperation(window.hronaut.selectTab(tabId))
  const closeTab = (tabId: string): Promise<BrowserState> => syncOperation(window.hronaut.closeTab(tabId))
  const navigate = (options: NavigateOptions): Promise<BrowserState> => syncOperation(window.hronaut.navigate(options))
  const back = (tabId?: string): Promise<BrowserState> => syncOperation(window.hronaut.back(tabId))
  const forward = (tabId?: string): Promise<BrowserState> => syncOperation(window.hronaut.forward(tabId))
  const reload = (tabId?: string): Promise<BrowserState> => syncOperation(window.hronaut.reload(tabId))

  return {
    state,
    activeTab,
    activeWorkspace,
    initialized,
    initializing,
    initializationError,
    initialize,
    dispose,
    acceptAuthoritativeState,
    syncOperation,
    refresh,
    openHome,
    newTab,
    selectTab,
    closeTab,
    navigate,
    back,
    forward,
    reload
  }
})
