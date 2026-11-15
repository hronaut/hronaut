import type { AgentGuideId } from '../agent-guides.js'
import type { ClaudeCodeSetupPreview, ClaudeCodeSetupResult, HomeSetupState } from '../claude-code-setup.js'
import type { Confirmation } from '../confirmation.js'
import type { HomeWorkspaceAction, HomeWorkspaceState } from '../home-workspaces.js'
import type { BrowserTabOverviewPreview, McpPortMoveResult } from '../types.js'
import type { HomeTabAction, HomeTabsState } from '../home-tabs.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** Home, Hronaut's own page in a tab: its workspaces, its setup of agents, and what it asks main to open or copy. */
export const HOME_IPC = {
  /** Main → Home: show the workspaces, asked for while Home is already open. */
  showWorkspaces: 'hronaut-home:show-workspaces' as EventChannel<[]>,
  /** Main → Home: something Home shows changed, so it reads its status again. Carries nothing. */
  changed: 'hronaut-home:changed' as EventChannel<[]>,
  /** Main → Home: show the Tabs view with the search field focused, for Search tabs. */
  showTabs: 'hronaut-home:show-tabs' as EventChannel<[]>,
  /** Main → Home: tabs changed, so a Home showing them reads them again. Carries nothing. */
  tabsChanged: 'hronaut-home:tabs-changed' as EventChannel<[]>,
  /** Home → main: the open tabs, recently closed tabs and archived workspaces the Tabs view lists. */
  tabs: 'hronaut-home:tabs' as InvokeChannel<[], HomeTabsState>,
  /** Home → main: the last frames kept of the given tabs, a sleeping tab's from before it slept; never captured anew. */
  tabPreviews: 'hronaut-home:tab-previews' as InvokeChannel<[tabIds: string[]], BrowserTabOverviewPreview[]>,
  /** Home → main: a bounded full-page picture of an awake, loaded tab. */
  tabPagePreview: 'hronaut-home:tab-page-preview' as InvokeChannel<[tabId: string], BrowserTabOverviewPreview>,
  /** Home → main: opens, closes, pins, labels or reopens a tab, restores or deletes an archived workspace. */
  tabAction: 'hronaut-home:tab-action' as InvokeChannel<[action: HomeTabAction], HomeTabsState>,
  /** Home → main: the workspaces Home lists. */
  workspaces: 'hronaut-home:workspaces' as InvokeChannel<[], HomeWorkspaceState>,
  /**
   * Home → main: opens, archives, restores, deletes or clears a workspace or changes its preferences, or opens the
   * shell's editor to create one, start one from a template, edit one or transfer one; answers the list after it.
   */
  workspaceAction: 'hronaut-home:workspace-action' as InvokeChannel<[request: HomeWorkspaceAction], HomeWorkspaceState>,
  /** Home → main: copies the text. */
  copyText: 'hronaut-home:copy-text' as InvokeChannel<[text: string], void>,
  /**
   * Home's main frame → main: asks in Hronaut's own dialog over the window, with Cancel focused; true only for OK, and
   * false at once for any other sender or a question without text.
   */
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
  /**
   * Home's main frame → main: the exact change to Claude Code's settings, as a single-use plan; refused while the MCP
   * token comes from HRONAUT_MCP_TOKEN.
   */
  claudeCodePrepare: 'hronaut-home:claude-code-prepare' as InvokeChannel<[], ClaudeCodeSetupPreview>,
  /**
   * Home's main frame → main: asks the person in main's own dialog, then makes the planned change; refused while the MCP
   * token comes from HRONAUT_MCP_TOKEN.
   */
  claudeCodeApply: 'hronaut-home:claude-code-apply' as InvokeChannel<[planId: string], ClaudeCodeSetupResult>,
  /** Home's main frame → main: moves a listener that could not start to the free port main offered; only that port is accepted. */
  useMcpPort: 'hronaut-home:use-mcp-port' as InvokeChannel<[port: number], McpPortMoveResult>
} as const
