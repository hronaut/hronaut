import { nextTick, watch, type Ref } from 'vue'

export interface ConsolePanelShellHandle {
  reset: (closePanel?: boolean) => void
  refresh: (clear?: boolean) => Promise<void>
}

export interface NetworkPanelShellHandle {
  reset: (closePanel?: boolean) => void
  refresh: (clear?: boolean) => Promise<void>
  refreshRoutes: (silent?: boolean) => Promise<void>
  refreshAll: () => Promise<void>
  openRequestConditions: () => Promise<void>
}

export interface DeveloperPanelsShellControllerOptions {
  consoleOpen: Ref<boolean>
  consolePanel: Readonly<Ref<ConsolePanelShellHandle | null>>
  networkOpen: Ref<boolean>
  networkPanel: Readonly<Ref<NetworkPanelShellHandle | null>>
  closeTransientPanels: () => void
  keepsSeparatePanelOpen: () => boolean
}

export function useDeveloperPanelsShellController(options: DeveloperPanelsShellControllerOptions) {
  let networkOpenSequence = 0
  let disposed = false

  const stopNetworkOpenTracking = watch(options.networkOpen, () => {
    networkOpenSequence += 1
  }, { flush: 'sync' })

  function resetConsole(closePanel = false): void {
    options.consolePanel.value?.reset(closePanel)
    if (closePanel && !options.keepsSeparatePanelOpen()) options.consoleOpen.value = false
  }

  async function refreshConsole(clear = false): Promise<void> {
    await nextTick()
    await options.consolePanel.value?.refresh(clear)
  }

  function toggleConsole(): void {
    if (options.consoleOpen.value) {
      options.consoleOpen.value = false
      return
    }
    options.closeTransientPanels()
    options.consoleOpen.value = true
  }

  function resetNetwork(closePanel = false): void {
    networkOpenSequence += 1
    options.networkPanel.value?.reset(closePanel)
    if (closePanel && !options.keepsSeparatePanelOpen()) options.networkOpen.value = false
  }

  async function refreshNetwork(clear = false): Promise<void> {
    await nextTick()
    await options.networkPanel.value?.refresh(clear)
  }

  async function refreshNetworkRoutes(silent = false): Promise<void> {
    await nextTick()
    await options.networkPanel.value?.refreshRoutes(silent)
  }

  async function refreshNetworkAll(): Promise<void> {
    await nextTick()
    await options.networkPanel.value?.refreshAll()
  }

  async function toggleNetwork(): Promise<void> {
    if (options.networkOpen.value) {
      options.networkOpen.value = false
      return
    }
    options.closeTransientPanels()
    options.networkOpen.value = true
    const sequence = networkOpenSequence
    await nextTick()
    if (disposed || sequence !== networkOpenSequence || !options.networkOpen.value) return
    await options.networkPanel.value?.refreshAll()
  }

  async function openRequestConditions(): Promise<void> {
    if (!options.networkOpen.value) {
      options.closeTransientPanels()
      options.networkOpen.value = true
      const sequence = networkOpenSequence
      await nextTick()
      if (disposed || sequence !== networkOpenSequence || !options.networkOpen.value) return
    }
    await options.networkPanel.value?.openRequestConditions()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    networkOpenSequence += 1
    stopNetworkOpenTracking()
  }

  return {
    resetConsole,
    refreshConsole,
    toggleConsole,
    resetNetwork,
    refreshNetwork,
    refreshNetworkRoutes,
    refreshNetworkAll,
    toggleNetwork,
    openRequestConditions,
    dispose
  }
}

export type DeveloperPanelsShellController = ReturnType<typeof useDeveloperPanelsShellController>
