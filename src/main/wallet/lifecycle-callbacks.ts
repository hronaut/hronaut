export interface WalletLifecycleBroker {
  cancelForNavigation(tabId: string, navigationGeneration: number): Promise<void>
  cancelForTab(tabId: string): Promise<void>
  resumeTab(tabId: string, navigationGeneration: number): Promise<void>
  cancelForWorkspace(workspaceId: string): Promise<void>
}

export interface WalletLifecycleCallbacks {
  onWalletNavigation(tabId: string, navigationGeneration: number): Promise<void> | undefined
  onWalletTabClosed(tabId: string): Promise<void> | undefined
  onWalletTabRestored(tabId: string, navigationGeneration: number): Promise<void> | undefined
  onWalletWorkspaceClosed(workspaceId: string): Promise<void> | undefined
}

export function createWalletLifecycleCallbacks(
  getBroker: () => WalletLifecycleBroker | null
): WalletLifecycleCallbacks {
  return {
    onWalletNavigation: (tabId, generation) => getBroker()?.cancelForNavigation(tabId, generation),
    onWalletTabClosed: (tabId) => getBroker()?.cancelForTab(tabId),
    onWalletTabRestored: (tabId, generation) => getBroker()?.resumeTab(tabId, generation),
    onWalletWorkspaceClosed: (workspaceId) => getBroker()?.cancelForWorkspace(workspaceId)
  }
}
