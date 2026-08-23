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
  let initializePromise: Promise<void> | null = null
  let unsubscribe: (() => void) | null = null

  function acceptAuthoritativeState(next: BrowserState): void {
    revision += 1
    state.value = next
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
        unsubscribe?.()
        unsubscribe = null
        initializationError.value = error
        initialized.value = false
        throw error
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
    unsubscribe?.()
    unsubscribe = null
    initializePromise = null
    initialized.value = false
    initializing.value = false
  }

  async function syncOperation(operation: Promise<BrowserState>): Promise<BrowserState> {
    const currentGeneration = generation
    const startingRevision = revision
    const next = await operation
    if (generation === currentGeneration && revision === startingRevision) acceptAuthoritativeState(next)
    return next
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
