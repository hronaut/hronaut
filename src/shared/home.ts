import type { AgentGuide, ClientConfigurationOptions } from './client-configuration.js'
import type { HomeWorkspaceAction, HomeWorkspaceState } from './home-workspaces.js'
import type { McpActivityOutcome, McpActivityResult, McpListenErrorCode, McpPortMoveResult, McpServerStatus } from './types.js'
import type { ResolvedThemeName } from './theme.js'
import type { ConnectedAgent } from './agent-status.js'
import type { AgentPresenceState, AgentRecentStep } from './agent-presence.js'
import type { AgentStepKind } from './agent-steps.js'
import type { MessageSchema } from './locales/en-US.js'
import type { ClaudeCodeSetupPreview, ClaudeCodeSetupResult, HomeSetupState } from './claude-code-setup.js'

export interface HomeReadinessCheck {
  state: string
  nextAction: keyof MessageSchema['home']['readiness']['nextAction']
  evidence?: { toolCount?: number; initializedClientCount?: number; observedToolCount?: number; missingToolCount?: number; missingTools?: string[]; toolName?: string; completedAt?: string }
}
export interface HomeDashboard {
  name: 'hronaut'
  version: string
  endpoint: string
  presentationRevision?: number
  theme?: ResolvedThemeName
  startedAt: string | null
  activeRequests: number
  totalRequests: number
  paused: boolean
  status: McpServerStatus
  error?: string
  /** With status 'error': a busy or refused port, the port that failed and a free one Hronaut can move to. */
  errorCode?: McpListenErrorCode
  failedPort?: number
  suggestedPort?: number
  completedToolCalls: number
  /** Each connected agent once, as the toolbar status counts them. */
  agents?: ConnectedAgent[]
  /** What agents are doing in each open workspace they are in, by workspace id. */
  workspaceActivity?: Record<string, HomeWorkspaceActivity>
  /** Agents' finished steps across workspaces, newest first, at most HOME_ACTIVITY_FEED_LIMIT. Memory only. */
  feed?: HomeFeedEntry[]
  /** Clients seen recently, without their session or credential ids. */
  clients: { name: string; version?: string; lastSeenAt: string; requestCount: number; activeRequests: number; initializedAt?: string; readinessProbe?: { outcome: 'verified' | 'failed' } }[]
  recentActivity: { activityId: string; tabId: string; toolName: string; startedAt: string; completedAt: string; durationMs: number; outcome: 'finished' | 'failed'; result?: McpActivityResult }[]
  toolMetrics: { toolName: string; failures: number }[]
  outcomeTotals?: Partial<Record<McpActivityOutcome, number>>
  tools: { name: string; category: string; description: string }[]
  readiness: { version: 1; checkedAt: string; checks: Record<keyof MessageSchema['home']['readiness']['checks'], HomeReadinessCheck> }
}
/** Finished steps Home keeps for its activity feed, in memory only. */
export const HOME_ACTIVITY_FEED_LIMIT = 50

/** What agents are doing in one open workspace: the leading agent (needs you, then working, then idle) first. */
export interface HomeWorkspaceActivity {
  state: AgentPresenceState
  /** Presence keys of the agents in it, in display order. */
  agentKeys: string[]
  /** What the leading agent's latest call does, and what it acts on (see AgentRecentStep.target). */
  step: AgentStepKind
  target?: string
}

/** One finished step for Home's feed: who did what, where and when. Targets are cleaned as for the shell. */
export interface HomeFeedEntry extends Omit<AgentRecentStep, 'answer'> {
  /** Opaque, unique within this run. */
  id: string
  agentKey: string
  agentName: string
  colorIndex: number
  workspaceId: string
}

export interface HomePageOptions extends ClientConfigurationOptions {
  workspaces?: HomeWorkspaceState
  initialState: HomeDashboard
}
export interface HomeBootstrap {
  locale: ClientConfigurationOptions['locale']
  guides: AgentGuide[]
  messages: MessageSchema
  dashboard: HomeDashboard
  workspaces: HomeWorkspaceState
}
export interface HronautHomeApi {
  onShowWorkspaces(listener: () => void): () => void
  /** Something Home shows changed; read /api/status again. Carries nothing. */
  onChanged?(listener: () => void): () => void
  getWorkspaces(): Promise<HomeWorkspaceState>
  workspaceAction(request: HomeWorkspaceAction): Promise<HomeWorkspaceState>
  copyText(text: string): Promise<void>
  openAgentGuide(id: AgentGuide['id']): Promise<void>
  openVsCodeInstall(): Promise<void>
  openSetupHelp(): Promise<void>
  openSetupFeedback(): Promise<void>
  /** Agents found on this computer, and whether Hronaut can add itself to Claude Code. */
  getSetupState?(): Promise<HomeSetupState>
  /** The exact change to Claude Code's settings, as a single-use plan. */
  prepareClaudeCodeSetup?(): Promise<ClaudeCodeSetupPreview>
  /** Main asks the person natively, then makes the planned change. */
  applyClaudeCodeSetup?(planId: string): Promise<ClaudeCodeSetupResult>
  /** Moves a listener that could not start to the free port main offered; only that port is accepted. */
  useMcpPort?(port: number): Promise<McpPortMoveResult>
}
