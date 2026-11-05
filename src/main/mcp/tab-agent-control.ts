import { hasPausedAgentTab, isTabAgentPaused, isTabTakenOver } from '../browser/agent-pause/agent-pause.js'
import type { Browser } from '../browser/browser.js'
import { getMcpGroupState } from '../browser/workspace-scope/workspace-scope.js'

const TAKEN_OVER = 'Agents are paused for this tab: the person took it over in the Hronaut window and has control. Wait until they hand it back; browser_tabs then shows agentPaused false and handedBack with a note of what changed.'

/** A tab exception never grants workspace-wide operations or bypasses ownership. */
export function requireTabAgentControl(
  manager: Browser,
  globallyPaused: boolean,
  name: string,
  input: Record<string, unknown>,
  targetsTab: boolean,
  resolvedTabId?: string
): void {
  const denied = (): never => { throw new Error('Agents are paused for this target. Resume the tab or all agents from the Hronaut window.') }
  if (!globallyPaused && !hasPausedAgentTab(manager)) return
  // Discovery and re-establishing existing ownership are necessary after reconnect.
  // These actions do not grant page access; normal resume-key and lease checks remain.
  if (name === 'browser_workspaces' && ['list', 'resume', 'ownership-status', 'claim-ownership', 'release-ownership'].includes(String(input.action ?? 'list'))) return
  const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId
    : typeof input.sourceWorkspaceId === 'string' ? input.sourceWorkspaceId : undefined
  if (!globallyPaused && !workspaceId) return
  if (!workspaceId) denied()
  const workspace = getMcpGroupState(manager, workspaceId!)
  if (name === 'browser_tabs' || name === 'browser_status') {
    if (!workspace.tabs.some(tab => !isTabAgentPaused(manager, tab.id))) denied()
    return
  }
  if (targetsTab) {
    const tabId = resolvedTabId ?? (typeof input.tabId === 'string' ? input.tabId : workspace.activeTabId)
    if (!tabId || !workspace.tabs.some(tab => tab.id === tabId)) denied()
    if (isTabAgentPaused(manager, tabId!)) {
      if (!globallyPaused && isTabTakenOver(manager, tabId!)) throw new Error(TAKEN_OVER)
      denied()
    }
    return
  }
  // Workspace/global tools can affect more than one page and cannot borrow a
  // single-tab exception. With global pause off, paused tabs still constrain them.
  if (globallyPaused || workspace.tabs.some(tab => isTabAgentPaused(manager, tab.id))) denied()
}
