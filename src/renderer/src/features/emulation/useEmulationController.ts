import { computed, ref, type Ref } from 'vue'
import type {
  BrowserEmulationState,
  BrowserState,
  BrowserTabState
} from '../../../../shared/types.js'
import { describeEmulation, emulationLabel } from '../../../../shared/emulation-description.js'

type Translate = (key: string, parameters?: Record<string, unknown>, plural?: number) => string

export interface EmulationControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  resetTabEmulation: (tabId: string) => Promise<BrowserState>
  syncState: (operation: Promise<BrowserState>) => Promise<void>
  responsivePanelOpen: () => boolean
  loadResponsiveDraft: (viewport?: BrowserEmulationState['viewport']) => void
  environmentPanelOpen: () => boolean
  loadEnvironmentDraft: (emulation?: BrowserEmulationState) => void
  translate: Translate
  formatNumber: (value: number) => string
  formatPercent: (value: number) => string
  onResetError: (error: unknown) => void
}

export function useEmulationController(options: EmulationControllerOptions) {
  const activeEmulation = computed(() => options.activeTab.value?.emulation)
  const resetPending = ref(false)
  let mutationSequence = 0
  let resetOperation = 0
  let disposed = false

  const label = (emulation: BrowserEmulationState): string => emulationLabel(emulation, options)
  const describe = (emulation: BrowserEmulationState): string => describeEmulation(emulation, options)

  function beginMutation(): number {
    return ++mutationSequence
  }

  function invalidateMutation(): void {
    mutationSequence += 1
  }

  function isMutationCurrent(sequence: number, tabId: string): boolean {
    return isMutationSequenceCurrent(sequence) && options.activeTab.value?.id === tabId
  }

  /** For a change to a tab that need not be the active one, such as the other pane of split view. */
  function isMutationSequenceCurrent(sequence: number): boolean {
    return !disposed && sequence === mutationSequence
  }

  async function resetActive(): Promise<boolean> {
    const tab = options.activeTab.value
    if (disposed || resetPending.value || !tab?.emulation) return false
    const mutation = beginMutation()
    const operation = ++resetOperation
    resetPending.value = true
    try {
      await options.syncState(options.resetTabEmulation(tab.id))
      if (!isMutationCurrent(mutation, tab.id)) return false
      if (options.responsivePanelOpen()) options.loadResponsiveDraft(options.activeTab.value?.emulation?.viewport)
      if (options.environmentPanelOpen()) options.loadEnvironmentDraft(options.activeTab.value?.emulation)
      return true
    } catch (error) {
      if (isMutationCurrent(mutation, tab.id)) options.onResetError(error)
      return false
    } finally {
      if (operation === resetOperation) resetPending.value = false
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    mutationSequence += 1
    resetOperation += 1
    resetPending.value = false
  }

  return {
    activeEmulation,
    resetPending,
    label,
    describe,
    beginMutation,
    invalidateMutation,
    isMutationCurrent,
    isMutationSequenceCurrent,
    resetActive,
    dispose
  }
}

export type EmulationController = ReturnType<typeof useEmulationController>
