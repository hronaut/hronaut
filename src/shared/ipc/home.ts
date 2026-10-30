import type { AgentGuideId } from '../agent-guides.js'
import type { ClaudeCodeSetupPreview, ClaudeCodeSetupResult, HomeSetupState } from '../claude-code-setup.js'
import type { Confirmation } from '../confirmation.js'
import type { HomeWorkspaceAction, HomeWorkspaceState } from '../home-workspaces.js'
import type { McpPortMoveResult } from '../types.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** Home, Hronaut's own page in a tab: its workspaces, its setup of agents, and what it asks main to open or copy. */
export const HOME_IPC = {
  /** Main → Home: show the workspaces, asked for while Home is already open. */
  showWorkspaces: 'hronaut-home:show-workspaces' as EventChannel<[]>,
  /** Main → Home: something Home shows changed, so it reads its status again. Carries nothing. */
  changed: 'hronaut-home:changed' as EventChannel<[]>,
  /** Home → main: the workspaces Home lists. */
  workspaces: 'hronaut-home:workspaces' as InvokeChannel<[], HomeWorkspaceState>,
  /**
   * Home → main: opens, archives, restores, deletes or clears a workspace, changes its preferences, or opens its editor in
   * the shell; answers the list after it.
   */
  workspaceAction: 'hronaut-home:workspace-action' as InvokeChannel<[request: HomeWorkspaceAction], HomeWorkspaceState>,
  /** Home → main: copies the text. */
  copyText: 'hronaut-home:copy-text' as InvokeChannel<[text: string], void>,
  /** Home → main: asks in Hronaut's own dialog over the window, with Cancel focused; true only for OK. */
  confirm: 'hronaut-home:confirm' as InvokeChannel<[question: Confirmation], boolean>,
  /** Home → main: opens the agent's setup guide outside Hronaut. */
  openAgentGuide: 'hronaut-home:open-agent-guide' as InvokeChannel<[clientId: AgentGuideId], void>,
  /** Home → main: opens VS Code's one-click install of Hronaut's MCP server; refused while MCP authentication is on. */
  openVsCodeInstall: 'hronaut-home:open-vscode-install' as InvokeChannel<[], void>,
  /** Home → main: opens the setup help outside Hronaut. */
  openSetupHelp: 'hronaut-home:open-setup-help' as InvokeChannel<[], void>,
  /** Home → main: opens where to give feedback on the setup, outside Hronaut. */
  openSetupFeedback: 'hronaut-home:open-setup-feedback' as InvokeChannel<[], void>,
  /** Home's main frame → main: agents found on this computer, and whether Hronaut can add itself to Claude Code. */
  setupState: 'hronaut-home:setup-state' as InvokeChannel<[], HomeSetupState>,
  /** Home's main frame → main: the exact change to Claude Code's settings, as a single-use plan. */
  claudeCodePrepare: 'hronaut-home:claude-code-prepare' as InvokeChannel<[], ClaudeCodeSetupPreview>,
  /** Home's main frame → main: asks the person in main's own dialog, then makes the planned change. */
  claudeCodeApply: 'hronaut-home:claude-code-apply' as InvokeChannel<[planId: string], ClaudeCodeSetupResult>,
  /** Home's main frame → main: moves a listener that could not start to the free port main offered; only that port is accepted. */
  useMcpPort: 'hronaut-home:use-mcp-port' as InvokeChannel<[port: number], McpPortMoveResult>
} as const
