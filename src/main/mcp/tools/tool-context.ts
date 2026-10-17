import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { z } from 'zod'
import type { FileEvaluationProgress } from '../../../shared/file-evaluation.js'
import type { McpTabActivity, UserAttentionInput, UserAttentionRequest } from '../../../shared/types.js'
import type { CookieWriteProgress } from '../../browser/cookie-write-operation.js'
import type { PendingElementInspection } from '../../browser/element-inspection-publication.js'
import { EMULATION_INPUT_ERRORS } from '../../browser/emulation-state.js'
import type { PendingFrameObservation } from '../../browser/frame-observation.js'
import type { NativeClickProgress } from '../../browser/native-click-admission.js'
import type { NativeKeyHoldProgress } from '../../browser/native-key-hold.js'
import type { PendingPdfExport } from '../../browser/pdf-export-publication.js'
import { STORAGE_COMPARISON_INPUT_ERRORS } from '../../browser/storage-comparison-operation.js'
import type { BrowserTabsManager } from '../../browser/tabs-manager.js'
import type { PendingVideoInspection } from '../../browser/video-recorder.js'
import { WEB_STORAGE_INPUT_ERRORS, type WebStorageProgress } from '../../browser/web-storage-operation.js'
import type { UserAttentionLifecycle } from '../../user-attention-lifecycle.js'
import { McpActionTracker } from '../action-tracker.js'
import type { AuditReceiptService } from '../audit-receipt-service.js'
import type { AuditReceiptAuthorization } from '../audit-receipt-store.js'
import type { McpCapabilityGrant, McpCapabilityProfile, McpCapabilityProfileStore } from '../capability-profile-store.js'
import type { HumanWaitingService } from '../human-waiting-service.js'
import type { TaskRunService } from '../task-run-service.js'
import { WorkspaceWriteLeaseRegistry } from '../workspace-write-leases.js'
import type { BookmarkOperations, HistoryOperations, McpClientActivity, SiteDataOperations, WalletAgentOperations, WalletAgentSessionRegistry, WalletAgentToolTarget } from '../server.js'

export type ResolvedTargetWakePolicy = 'before-handler' | 'handler-owned' | 'never'
export type WorkspaceToolHandler<T> = ((input: T) => Promise<CallToolResult>) & {
  resolvedTargetWakePolicy?: ResolvedTargetWakePolicy
  tabActivityToolName?: string
}

/** What one MCP call carries through its handler, for the publication and settlement checks in server.ts. */
export type McpFrameRequest = { labeledCreation?: { attempted: boolean; policy?: Record<string, unknown>; certificate?: () => void; refreshCertificate?: () => Promise<void>; reviewFinalizationFailed?: boolean; cancelled?: () => boolean; publication?: () => void; finish?: (result: CallToolResult) => void; knownNotSaved?: boolean }; fileEvaluation?: FileEvaluationProgress; fileEvaluationCertificate?: () => void; fileEvaluationRefreshCertificate?: () => Promise<void>; fileEvaluationPublication?: { validate(): void; dispose(): void }; fileEvaluationCompletion?: Promise<void>; fileEvaluationFinishActivity?: (result: CallToolResult) => void; fileEvaluationFinishing?: boolean; storageComparison?: { started: boolean; changed: boolean; inputError?: keyof typeof STORAGE_COMPARISON_INPUT_ERRORS; publication?: { validate(): void; dispose(): void }; policy?: Record<string, unknown>; finishActivity?: (result: CallToolResult) => void; finishing?: boolean; reviewFinalizationFailed?: boolean }; clickAuthority?: { validate(): void; dispose(): void }; clickProgress?: NativeClickProgress; clickPolicy?: Record<string, unknown>; clickPublication?: () => void; clickFinishActivity?: (result: CallToolResult) => void; clickFinishing?: boolean; clickReviewFinalizationFailed?: boolean; storageInspection?: { started: boolean; publication?: () => void; policy?: Record<string, unknown>; finishActivity?: (result: CallToolResult) => void; finishing?: boolean; reviewFinalizationFailed?: boolean }; webStorageProgress?: WebStorageProgress; webStorageInputError?: keyof typeof WEB_STORAGE_INPUT_ERRORS; webStoragePolicy?: Record<string, unknown>; webStoragePublication?: () => void; webStorageFinishActivity?: (result: CallToolResult) => void; webStorageFinishing?: boolean; webStorageReviewFinalizationFailed?: boolean; cookieProgress?: CookieWriteProgress; cookiePolicy?: Record<string, unknown>; cookiePublication?: () => void; cookieFinishActivity?: (result: CallToolResult) => void; cookieFinishing?: boolean; cookieReviewFinalizationFailed?: boolean; emulationInputError?: keyof typeof EMULATION_INPUT_ERRORS; conditionPolicy?: Record<string, unknown>; conditionReviewFinalizationFailed?: boolean; conditionFinishActivity?: (result: CallToolResult) => void; conditionFinishing?: boolean; conditionPublication?: () => void; conditionAttempted?: boolean; pending?: PendingFrameObservation; elementInspection?: PendingElementInspection; imageFinishActivity?: (result: CallToolResult) => void; imageFinishing?: boolean; videoInspection?: PendingVideoInspection; pdfExport?: PendingPdfExport; networkPublication?: () => void; tabDiscoveryPublication?: () => void; pageObservationPublication?: () => void; selectionFinishActivity?: (result: CallToolResult) => void; selectionFinishing?: boolean; selectionSubmitted?: boolean; selectionPolicy?: Record<string, unknown>; selectionReviewFinalizationFailed?: boolean; selectionAuthority?: { validate: () => void; dispose: () => void }; selectionPublication?: () => void; wheelAttempted?: boolean; wheelReviewFinalizationFailed?: boolean; wheelPublication?: () => void; keyHoldProgress?: NativeKeyHoldProgress; keyHoldPolicy?: Record<string, unknown>; keyHoldReviewFinalizationFailed?: boolean; keyHoldPublication?: () => void; assertCurrent?: () => void; tabId?: string }

/**
 * What a tool's registration may use from the MCP server it is registered on: the browser, the calling client,
 * its authorizations, and the shared wrappers that admit, guard and settle each call (see server.ts).
 */
export interface McpToolContext {
  manager: BrowserTabsManager
  client: McpClientActivity
  bookmarks: BookmarkOperations
  history: HistoryOperations
  siteData: SiteDataOperations
  wallets: WalletAgentOperations | undefined
  auditReceipts: AuditReceiptService | undefined
  humanWaiting: HumanWaitingService | undefined
  taskRuns: TaskRunService | undefined
  userAttentionLifecycle: UserAttentionLifecycle | undefined
  capability: { store: McpCapabilityProfileStore; grant: McpCapabilityGrant } | undefined
  capabilityProfile: McpCapabilityProfile | undefined
  auditAuthorization: AuditReceiptAuthorization
  humanReviewSessionBinding: string
  publicOutcomeFingerprintKey: Buffer
  savedTaskPreviewKey: Buffer
  activeWorkspaceIds: Set<string>
  savedWorkspaceIds: Set<string>
  frameRequests: AsyncLocalStorage<McpFrameRequest>
  workspaceToolInputSchemas: Map<string, z.ZodObject<Record<string, z.ZodType>>>
  actionTracker: McpActionTracker
  workspaceLeases: WorkspaceWriteLeaseRegistry
  showWindowInactive: () => void
  getPaused: () => boolean
  getUserAttention: () => UserAttentionRequest | null
  requestUserAttention: (request: UserAttentionInput) => Promise<UserAttentionRequest>
  onTabActivity: ((activity: McpTabActivity, workspaceId: string) => void) | undefined
  registerTool: McpServer['registerTool']
  registerWorkspaceTool: <T extends object>(name: string, config: {
    description?: string
    inputSchema?: Record<string, z.ZodType>
  }, handler: WorkspaceToolHandler<T>) => void
  tool: <T>(handler: (input: T, extra?: { signal?: AbortSignal }) => Promise<CallToolResult> | CallToolResult) => (input: T, extra?: { signal?: AbortSignal }) => Promise<CallToolResult>
  tabTool: <T>(
    toolName: string,
    handler: (input: T) => Promise<CallToolResult> | CallToolResult,
    resolvedTargetWakePolicy?: ResolvedTargetWakePolicy
  ) => WorkspaceToolHandler<T>
  withResolvedTargetWakePolicy: <T>(
    handler: (input: T) => Promise<CallToolResult>,
    resolvedTargetWakePolicy: ResolvedTargetWakePolicy
  ) => WorkspaceToolHandler<T>
  requireActiveCapabilityDispatch: (
    name: string,
    input: Record<string, unknown>,
    target?: { workspaceId: string; tabId?: string; origins?: string[] }
  ) => McpCapabilityProfile | undefined
  capabilityAllowsUrl: (profile: McpCapabilityProfile | undefined, url: string) => boolean
  requireAgentWorkspace: (workspaceId: string) => ReturnType<BrowserTabsManager['requireMcpTabGroup']>
  requireSavedWorkspace: (workspaceId: string) => void
  authorizeResume: (workspaceId: string, resumeKey: string, saved: boolean) => void
  authorizedActiveWorkspaces: () => ReturnType<BrowserTabsManager['listMcpTabGroups']>
  authorizedSavedWorkspaces: () => ReturnType<BrowserTabsManager['listSavedTabGroups']>
  workspaceAuthorizationError: () => Error
  withResumeKey: <T extends { id: string }>(workspace: T) => T & { resumeKey: string }
  forkOnlySource: (source: ReturnType<BrowserTabsManager['listWorkspaceForkSources']>[number]) => ReturnType<BrowserTabsManager['listWorkspaceForkSources']>[number] & {
    forkOnly: true
    forkWith: { action: 'create'; storage: 'fork-workspace'; sourceWorkspaceId: string }
  }
  leaseLostAfterDispatch: (error: unknown) => CallToolResult
  reviewedActionArguments: (input: Record<string, unknown>, toolName?: string) => Record<string, unknown>
  requireWallets: () => WalletAgentOperations
  requireWalletSessions: () => WalletAgentSessionRegistry
  walletTarget: (walletSessionId: string, workspaceId: string, tabId: string) => WalletAgentToolTarget
}
