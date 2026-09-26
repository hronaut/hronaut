import type { AgentGuide, ClientConfigurationOptions } from './client-configuration.js'
import type { HomeWorkspaceAction, HomeWorkspaceState } from './home-workspaces.js'
import type { McpActivityOutcome, McpActivityResult, McpServerStatus } from './types.js'
import type { ResolvedThemeName } from './theme.js'
import type { MessageSchema } from './locales/en-US.js'

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
  completedToolCalls: number
  clients: { id: string; name: string; version?: string; lastSeenAt: string; requestCount: number; activeRequests: number; initializedAt?: string; readinessProbe?: { outcome: 'verified' | 'failed' } }[]
  recentActivity: { activityId: string; tabId: string; toolName: string; startedAt: string; completedAt: string; durationMs: number; outcome: 'finished' | 'failed'; result?: McpActivityResult }[]
  toolMetrics: { toolName: string; failures: number }[]
  outcomeTotals?: Partial<Record<McpActivityOutcome, number>>
  tools: { name: string; category: string; description: string }[]
  readiness: { version: 1; checkedAt: string; checks: Record<keyof MessageSchema['home']['readiness']['checks'], HomeReadinessCheck> }
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
  getWorkspaces(): Promise<HomeWorkspaceState>
  workspaceAction(request: HomeWorkspaceAction): Promise<HomeWorkspaceState>
  copyText(text: string): Promise<void>
  openAgentGuide(id: AgentGuide['id']): Promise<void>
  openVsCodeInstall(): Promise<void>
  openSetupHelp(): Promise<void>
  openSetupFeedback(): Promise<void>
}
