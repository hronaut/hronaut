import type { BrowserState } from '../../shared/types.js'

interface AgentControlManager {
  getState(): BrowserState
  getMcpGroupState(workspaceId: string): BrowserState
  isTabAgentPaused?(tabId: string): boolean
}

/** A tab exception never grants workspace-wide operations or bypasses ownership. */
export function requireTabAgentControl(
  manager: AgentControlManager,
  globallyPaused: boolean,
  name: string,
  input: Record<string, unknown>,
  targetsTab: boolean,
  resolvedTabId?: string
): void {
  const denied = (): never => { throw new Error('Agents are paused for this target. Resume the tab or all agents from the Hronaut window.') }
  if (!manager.isTabAgentPaused) {
    if (globallyPaused) denied()
    return
  }
  const state = manager.getState()
  if (!globallyPaused && !state.tabs.some(tab => manager.isTabAgentPaused!(tab.id))) return
  // Discovery and re-establishing existing ownership are necessary after reconnect.
  // These actions do not grant page access; normal resume-key and lease checks remain.
  if (name === 'browser_workspaces' && ['list', 'resume', 'ownership-status', 'claim-ownership', 'release-ownership'].includes(String(input.action ?? 'list'))) return
  const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId
    : typeof input.sourceWorkspaceId === 'string' ? input.sourceWorkspaceId : undefined
  if (!globallyPaused && !workspaceId) return
  if (!workspaceId) denied()
  const workspace = manager.getMcpGroupState(workspaceId!)
  if (name === 'browser_tabs' || name === 'browser_status') {
    if (!workspace.tabs.some(tab => !manager.isTabAgentPaused!(tab.id))) denied()
    return
  }
  if (targetsTab) {
    const tabId = resolvedTabId ?? (typeof input.tabId === 'string' ? input.tabId : workspace.activeTabId)
    if (!tabId || !workspace.tabs.some(tab => tab.id === tabId) || manager.isTabAgentPaused(tabId)) denied()
    return
  }
  // Workspace/global tools can affect more than one page and cannot borrow a
  // single-tab exception. With global pause off, paused tabs still constrain them.
  if (globallyPaused || workspace.tabs.some(tab => manager.isTabAgentPaused!(tab.id))) denied()
}
