import { EmulationInputError } from '../browser/emulation-state.js'
import { StorageComparisonInputError } from '../browser/storage-comparison-operation.js'
import { NativeClickAdmissionError } from '../browser/native-click-admission.js'
import { WebStorageInputError } from '../browser/web-storage-operation.js'
import { NativeWheelOutcomeUnknownError } from '../browser/native-wheel.js'
import { NativeKeyHoldOutcomeUnknownError } from '../browser/native-key-hold.js'
import { NativeInputCleanupError } from '../browser/native-input-cleanup.js'
import type { UserAttentionLifecycle } from '../user-attention-lifecycle.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { requireTabAgentControl } from './tab-agent-control.js'
import { BROWSER_SERVER_INSTRUCTIONS, BROWSER_TOOL_CATALOG, mcpToolCatalogForSet, type BrowserToolDefinition } from './tool-catalog.js'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { AuditReceiptService } from './audit-receipt-service.js'
import type { AuditVerificationUpdate } from './audit-receipt-run.js'
import type { AuditReceiptAuthorization } from './audit-receipt-store.js'
import { runPostWriteVerification } from './post-write-verification-runner.js'
import type { BrowserPostcondition } from '../../shared/post-write-postcondition.js'
import type { BrowserReconciliationCondition } from '../../shared/browser-reconciliation.js'
import type { HumanWaitingReviewBinding, HumanWaitingService } from './human-waiting-service.js'
import { humanWaitingArtifactHash } from './human-waiting-store.js'
import type { TaskRunService } from './task-run-service.js'
import { McpCapabilityAuthorizationError, type McpCapabilityGrant, type McpCapabilityProfile, type McpCapabilityProfileStore, type McpCapabilityRequest } from './capability-profile-store.js'
import {
  browserActionAuthorityReason,
  browserActionOperationClass,
  browserActionPayloadFingerprint,
  browserActionTarget,
  captureBrowserActionAuthority,
  type BrowserActionAuthorityReason
} from './browser-action-authority.js'
import { McpActionTracker } from './action-tracker.js'
import { WorkspaceWriteLeaseError, WorkspaceWriteLeaseRegistry } from './workspace-write-leases.js'
import type { AgentCall } from './agent-presence.js'
import { agentStepAddress } from '../../shared/agent-steps.js'
import { webAddress } from '../browser/url.js'
import type { BrowserTabsManager } from '../browser/tabs-manager.js'
import type { BrowserState, McpTabActivity, UserAttentionInput, UserAttentionRequest } from '../../shared/types.js'
import type { McpToolSet } from '../../shared/mcp-tool-sets.js'
import { type PublicBrowserReconciliation, classifyMcpActivityResult, closedTabWaitResult, errorResult, isTimeoutError, mcpWorkspaceState, nativeClickFailureResult, nativeInputCleanupResult, nativeKeyHoldUnknownResult, nativeWheelUnknownResult, publicBrowserReconciliation, textResult, toolDefinition } from './tool-results.js'
import { mcpCapabilityAction, mcpCapabilityOperationClass } from './capability-classification.js'
import { workspaceIdSchema } from './tool-schemas.js'
import { registerBrowserWorkspaces } from './tools/browser-workspaces/index.js'
import { registerBrowserSavedWorkspaces } from './tools/browser-saved-workspaces/index.js'
import { registerBrowserHumanWaiting } from './tools/browser-human-waiting/index.js'
import { registerBrowserContinuity } from './tools/browser-continuity/index.js'
import { registerBrowserPreflight } from './tools/browser-preflight/index.js'
import { registerBrowserAuditReceipts } from './tools/browser-audit-receipts/index.js'
import { registerBrowserTaskRuns } from './tools/browser-task-runs/index.js'
import { registerBrowserStatus } from './tools/browser-status/index.js'
import { registerBrowserShow } from './tools/browser-show/index.js'
import { registerBrowserUserAttention } from './tools/browser-user-attention/index.js'
import { registerBrowserRequestUserAttention } from './tools/browser-request-user-attention/index.js'
import { registerBrowserTabs } from './tools/browser-tabs/index.js'
import { registerBrowserNewTab } from './tools/browser-new-tab/index.js'
import { registerBrowserSelectTab } from './tools/browser-select-tab/index.js'
import { registerBrowserCloseTab } from './tools/browser-close-tab/index.js'
import { registerBrowserBookmarks } from './tools/browser-bookmarks/index.js'
import { registerBrowserVisitHistory } from './tools/browser-visit-history/index.js'
import { registerBrowserSiteData } from './tools/browser-site-data/index.js'
import { registerBrowserStorage } from './tools/browser-storage/index.js'
import { registerBrowserStorageChanges } from './tools/browser-storage-changes/index.js'
import { registerBrowserStorageUsage } from './tools/browser-storage-usage/index.js'
import { registerBrowserIndexeddb } from './tools/browser-indexeddb/index.js'
import { registerBrowserPwaLifecycle } from './tools/browser-pwa-lifecycle/index.js'
import { registerBrowserPwa } from './tools/browser-pwa/index.js'
import { registerBrowserNavigate } from './tools/browser-navigate/index.js'
import { registerBrowserHistory } from './tools/browser-history/index.js'
import { registerBrowserSnapshot } from './tools/browser-snapshot/index.js'
import { registerBrowserPublicOutcome } from './tools/browser-public-outcome/index.js'
import { registerBrowserFind } from './tools/browser-find/index.js'
import { registerBrowserElementInspect } from './tools/browser-element-inspect/index.js'
import { registerBrowserMediaState } from './tools/browser-media-state/index.js'
import { registerBrowserImageState } from './tools/browser-image-state/index.js'
import { registerBrowserGenerateLocator } from './tools/browser-generate-locator/index.js'
import { registerBrowserReconciliation } from './tools/browser-reconciliation/index.js'
import { registerBrowserClick } from './tools/browser-click/index.js'
import { registerBrowserDialog } from './tools/browser-dialog/index.js'
import { registerBrowserType } from './tools/browser-type/index.js'
import { registerBrowserSelect } from './tools/browser-select/index.js'
import { registerBrowserFillForm } from './tools/browser-fill-form/index.js'
import { registerBrowserHover } from './tools/browser-hover/index.js'
import { registerBrowserDrag } from './tools/browser-drag/index.js'
import { registerBrowserWheel } from './tools/browser-wheel/index.js'
import { registerBrowserScroll } from './tools/browser-scroll/index.js'
import { registerBrowserHoldKey } from './tools/browser-hold-key/index.js'
import { registerBrowserPress } from './tools/browser-press/index.js'
import { registerBrowserFileUpload } from './tools/browser-file-upload/index.js'
import { registerBrowserWait } from './tools/browser-wait/index.js'
import { registerBrowserEmulate } from './tools/browser-emulate/index.js'
import { registerBrowserPageLifecycle } from './tools/browser-page-lifecycle/index.js'
import { registerBrowserZoom } from './tools/browser-zoom/index.js'
import { registerBrowserAudio } from './tools/browser-audio/index.js'
import { registerBrowserScreenshot } from './tools/browser-screenshot/index.js'
import { registerBrowserPdfSave } from './tools/browser-pdf-save/index.js'
import { registerBrowserResize } from './tools/browser-resize/index.js'
import { registerBrowserAccessibilityAudit } from './tools/browser-accessibility-audit/index.js'
import { registerBrowserQualityAudit } from './tools/browser-quality-audit/index.js'
import { registerBrowserPerformance } from './tools/browser-performance/index.js'
import { registerBrowserDesignOverview } from './tools/browser-design-overview/index.js'
import { registerBrowserPageMetadata } from './tools/browser-page-metadata/index.js'
import { registerBrowserMemory } from './tools/browser-memory/index.js'
import { registerBrowserSecurity } from './tools/browser-security/index.js'
import { registerBrowserReact } from './tools/browser-react/index.js'
import { registerBrowserCodeCoverage } from './tools/browser-code-coverage/index.js'
import { registerBrowserCpuProfile } from './tools/browser-cpu-profile/index.js'
import { registerBrowserDebugReport } from './tools/browser-debug-report/index.js'
import { registerBrowserVideo } from './tools/browser-video/index.js'
import { registerBrowserRepro } from './tools/browser-repro/index.js'
import { registerBrowserDomChanges } from './tools/browser-dom-changes/index.js'
import { registerBrowserLiveRegion } from './tools/browser-live-region/index.js'
import { registerBrowserCssStatePreview } from './tools/browser-css-state-preview/index.js'
import { registerBrowserVisualCompare } from './tools/browser-visual-compare/index.js'
import { registerBrowserConsole } from './tools/browser-console/index.js'
import { registerBrowserDiagnosticLogs } from './tools/browser-diagnostic-logs/index.js'
import { registerBrowserIssues } from './tools/browser-issues/index.js'
import { registerBrowserNetwork } from './tools/browser-network/index.js'
import { registerBrowserNetworkWait } from './tools/browser-network-wait/index.js'
import { registerBrowserNetworkSearch } from './tools/browser-network-search/index.js'
import { registerBrowserNetworkRequest } from './tools/browser-network-request/index.js'
import { registerBrowserNetworkReplay } from './tools/browser-network-replay/index.js'
import { registerBrowserNetworkHar } from './tools/browser-network-har/index.js'
import { registerBrowserNetworkRoutes } from './tools/browser-network-routes/index.js'
import { registerBrowserDownloads } from './tools/browser-downloads/index.js'
import { registerBrowserWebmcp } from './tools/browser-webmcp/index.js'
import { registerBrowserEvaluateFile } from './tools/browser-evaluate-file/index.js'
import { registerBrowserEvaluate } from './tools/browser-evaluate/index.js'
import { registerWalletList } from './tools/wallet-list/index.js'
import { registerWalletBalance } from './tools/wallet-balance/index.js'
import { registerWalletPrepareTransaction } from './tools/wallet-prepare-transaction/index.js'
import { registerWalletRequest } from './tools/wallet-request/index.js'
import { registerWalletRequestStatus } from './tools/wallet-request-status/index.js'
import { registerWalletPageRequests } from './tools/wallet-page-requests/index.js'
import { registerWalletCancelRequest } from './tools/wallet-cancel-request/index.js'
import type { McpToolContext, ResolvedTargetWakePolicy, ToolActivityClassification, ToolCallSettlement, ToolOptions, WorkspaceToolCall, WorkspaceToolHandler, WorkspaceToolOptions } from './tools/tool-context.js'
import type { BookmarkOperations, HistoryOperations, SiteDataOperations } from './browser-data-operations.js'
import type { WalletAgentOperations, WalletAgentSessionRegistry, WalletAgentToolTarget } from './wallet-agent-sessions.js'
import type { McpClientActivity } from './http-server.js'

/**
 * One client session's MCP server: the shared wrappers that admit, guard and settle every tool call the same way,
 * and the tool registrations in order. Each tool lives in tools/<tool>/ and declares what differs about its calls
 * in its registration options and settlement (tools/tool-context.ts).
 */
function matchesWorkspaceResumeKey(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8')
  const suppliedBytes = Buffer.from(supplied, 'utf8')
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes)
}

function requiresWorkspaceWriteLease(toolName: string, input: Record<string, unknown>, exempt: boolean): boolean {
  return mcpCapabilityOperationClass(toolName, input) !== 'read' && !exempt
}

export function assertMcpToolRegistrationContract(
  catalog: readonly Pick<BrowserToolDefinition, 'name'>[],
  registeredNames: readonly string[]
): void {
  const duplicates = (names: readonly string[]) => [...new Set(names.filter((name, index) => names.indexOf(name) !== index))].sort()
  const catalogNames = catalog.map((tool) => tool.name)
  const catalogSet = new Set(catalogNames)
  const registeredSet = new Set(registeredNames)
  const duplicateCatalogNames = duplicates(catalogNames)
  const duplicateRegisteredNames = duplicates(registeredNames)
  const issues = [
    duplicateCatalogNames.length ? `duplicate catalog tools: ${duplicateCatalogNames.join(', ')}` : '',
    duplicateRegisteredNames.length ? `duplicate registrations: ${duplicateRegisteredNames.join(', ')}` : '',
    ...[...catalogSet].filter((name) => !registeredSet.has(name)).sort().map((name) => `missing registration: ${name}`),
    ...[...registeredSet].filter((name) => !catalogSet.has(name)).sort().map((name) => `unadvertised registration: ${name}`)
  ].filter(Boolean)
  if (issues.length) throw new Error(`Invalid MCP tool contract (${issues.join('; ')})`)
}

function publicObserverAllowsTool(name: string, allowed: boolean): boolean {
  return name.startsWith('browser_') && (toolDefinition(name).annotations.readOnlyHint || allowed)
}

function scopeBrowserStateResult(result: CallToolResult, state: BrowserState): CallToolResult {
  if (result.isError) return result
  return {
    ...result,
    content: result.content.map((item) => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as Record<string, unknown>
        if (!Array.isArray(value.tabs) || typeof value.profilePath !== 'string') return item
        const { tabs: _tabs, closedTabs: _closedTabs, mcpTabGroups: _groups, savedTabGroups: _savedGroups, ...valueRest } = value
        return { ...item, text: JSON.stringify({ ...valueRest, ...mcpWorkspaceState(state) }, null, 2) }
      } catch {
        return item
      }
    })
  }
}

function withPostWriteVerification(result: CallToolResult, verification: { status: string; reason: string; attempt: number }): CallToolResult {
  return {
    ...result,
    content: result.content.map(item => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return item
        return { ...item, text: JSON.stringify({ ...value, postWriteVerification: verification }, null, 2) }
      } catch { return item }
    })
  }
}

function withPreWriteReconciliation(result: CallToolResult, reconciliation: PublicBrowserReconciliation): CallToolResult {
  const structured = result.structuredContent
  return {
    ...result,
    ...(structured && typeof structured === 'object' && !Array.isArray(structured)
      ? { structuredContent: { ...structured, preWriteReconciliation: reconciliation } } : {}),
    content: result.content.map(item => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return item
        return { ...item, text: JSON.stringify({ ...value, preWriteReconciliation: reconciliation }, null, 2) }
      } catch { return item }
    })
  }
}

function withReconciliationOutcome(result: CallToolResult, outcome: {
  status: 'verified' | 'blocked' | 'reconciliation_required'
  authoritativeReadback: 'verified' | 'not-verified'
  dispatch: 'not-dispatched' | 'dispatched-once'
}): CallToolResult {
  const structured = result.structuredContent
  return {
    ...result,
    ...(structured && typeof structured === 'object' && !Array.isArray(structured)
      ? { structuredContent: { ...structured, reconciliationOutcome: outcome } } : {}),
    content: result.content.map(item => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return item
        return { ...item, text: JSON.stringify({ ...value, reconciliationOutcome: outcome }, null, 2) }
      } catch { return item }
    })
  }
}

function withReviewContinuation(result: CallToolResult, continuation: {
  id: string
  revision: string
  nextStep: number
  totalSteps: number
}): CallToolResult {
  const structured = result.structuredContent
  return {
    ...result,
    ...(structured && typeof structured === 'object' && !Array.isArray(structured)
      ? { structuredContent: { ...structured, reviewContinuation: continuation } } : {}),
    content: result.content.map(item => {
      if (item.type !== 'text') return item
      try {
        const value = JSON.parse(item.text) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return item
        return { ...item, text: JSON.stringify({ ...value, reviewContinuation: continuation }, null, 2) }
      } catch { return item }
    })
  }
}

export function createBrowserMcpServer(
  manager: BrowserTabsManager,
  showWindowInactive: () => void,
  getUserAttention: () => UserAttentionRequest | null,
  requestUserAttention: (request: UserAttentionInput) => Promise<UserAttentionRequest>,
  bookmarks: BookmarkOperations,
  history: HistoryOperations,
  siteData: SiteDataOperations,
  version: string,
  toolSet: McpToolSet,
  client: McpClientActivity,
  capability?: { store: McpCapabilityProfileStore; grant: McpCapabilityGrant },
  wallets?: WalletAgentOperations,
  walletSessions?: WalletAgentSessionRegistry,
  onTabActivity?: (activity: McpTabActivity, workspaceId: string) => void,
  auditReceipts?: AuditReceiptService,
  getPaused: () => boolean = () => false,
  actionTracker = new McpActionTracker(),
  authorizeAutomation?: () => Promise<void>,
  humanWaiting?: HumanWaitingService,
  taskRuns?: TaskRunService,
  workspaceLeases = new WorkspaceWriteLeaseRegistry(),
  assertAutomationAccess?: () => void,
  userAttentionLifecycle?: UserAttentionLifecycle,
  onAgentCall?: (call: AgentCall, workspaceId: string) => void
): { server: McpServer } {
  const server = new McpServer(
    { name: 'hronaut', version },
    { instructions: BROWSER_SERVER_INSTRUCTIONS }
  )
  const savedTaskPreviewKey = randomBytes(32)
  const tool = <T, E = { signal?: AbortSignal }>(handler: (input: T, extra: E) => Promise<CallToolResult> | CallToolResult) => async (input: T, extra: E): Promise<CallToolResult> => {
    try {
      return await handler(input, extra)
    } catch (error) {
      if (error instanceof EmulationInputError) rememberInputPolicy(error)
      // Keep trusted native-dispatch provenance until workspace settlement has
      // recorded its uncertain outcome and attempted review finalization.
      if (error instanceof NativeInputCleanupError || error instanceof NativeWheelOutcomeUnknownError || error instanceof WebStorageInputError || error instanceof StorageComparisonInputError || error instanceof EmulationInputError) throw error
      return errorResult(error)
    }
  }
  const withResolvedTargetWakePolicy = <T, S = undefined>(
    handler: (input: T, call: WorkspaceToolCall<S>) => Promise<CallToolResult>,
    resolvedTargetWakePolicy: ResolvedTargetWakePolicy
  ): WorkspaceToolHandler<T, S> => Object.assign(handler, { resolvedTargetWakePolicy })
  const tabTool = <T, S = undefined>(
    toolName: string,
    handler: (input: T, call: WorkspaceToolCall<S>) => Promise<CallToolResult> | CallToolResult,
    resolvedTargetWakePolicy: ResolvedTargetWakePolicy = 'before-handler'
  ): WorkspaceToolHandler<T, S> => Object.assign(tool(handler), {
    resolvedTargetWakePolicy,
    tabActivityToolName: toolName
  })

  const baseRegisterTool = server.registerTool.bind(server)
  const capabilityProfile = capability?.store.requireActiveGrant(capability.grant)
  const capabilityAuthorizationFingerprint = createHash('sha256').update(JSON.stringify(
    capability ? { kind: 'capability-profile', ...capability.grant } : { kind: 'compatibility-full-access' }
  )).digest('hex')
  const auditAuthorization: AuditReceiptAuthorization = capability
    ? { kind: 'capability-profile', lineage: capability.store.authorizationLineage(capability.grant) }
    : { kind: 'full-access' }
  const toolSetCatalog = mcpToolCatalogForSet(toolSet)
    .filter(({ name }) => !capabilityProfile || capabilityProfile.allowedTools.includes(name))
  const toolSetToolNames = new Set(toolSetCatalog.map(({ name }) => name))
  const agentControlContext = new AsyncLocalStorage<() => void>()
  const singleTabControlTools = new Set<string>()
  const toolOptions = new Map<string, ToolOptions<ToolCallSettlement | undefined>>()
  const requireAgentControl = (name: string, input: Record<string, unknown>, tabId?: string): void => {
    requireTabAgentControl(manager, getPaused(), name, input, singleTabControlTools.has(name), tabId)
  }
  const implementedToolNames: string[] = []
  const registeredToolNames: string[] = []
  const capabilityRequest = (
    name: string,
    input: Record<string, unknown>,
    target?: { workspaceId: string; tabId?: string; origins?: string[] }
  ): McpCapabilityRequest => {
    const origins: string[] = [...(target?.origins ?? [])]
    for (const key of ['url', 'origin', 'expectedOrigin', 'targetUrl'] as const) {
      if (typeof input[key] === 'string') origins.push(input[key])
    }
    if (Array.isArray(input.origins)) {
      origins.push(...input.origins.filter((origin): origin is string => typeof origin === 'string'))
    }
    const workspaceId = target?.workspaceId
      ?? (typeof input.workspaceId === 'string' ? input.workspaceId : undefined)
    const pageOrigins = toolOptions.get(name)?.pageOrigins
    if (workspaceId && pageOrigins !== 'none') {
      try {
        const state = manager.getMcpGroupState(workspaceId)
        const tabId = target?.tabId
          ?? (typeof input.tabId === 'string' ? input.tabId : state.activeTabId)
        if (pageOrigins === 'all-tabs') origins.push(...state.tabs.map(tab => tab.url))
        else {
          const tab = state.tabs.find(candidate => candidate.id === tabId)
          if (tab) origins.push(tab.url)
        }
      } catch {
        // Workspace ownership and availability are checked by the tool itself.
      }
    }
    return {
      toolName: name,
      ...(mcpCapabilityAction(name, input) ? { action: mcpCapabilityAction(name, input) } : {}),
      operationClass: mcpCapabilityOperationClass(name, input),
      ...(workspaceId ? { workspaceId } : {}),
      ...(origins.length ? { origins: [...new Set(origins)] } : {}),
      arguments: input
    }
  }
  const authorizeCapability = async (
    name: string,
    input: Record<string, unknown>,
    phase: 'admission' | 'consume' | 'active-dispatch'
  ): Promise<void> => {
    if (!capability) return
    const request = capabilityRequest(name, input)
    if (phase === 'consume') await capability.store.authorizeAndConsume(capability.grant, request)
    else if (phase === 'active-dispatch') capability.store.authorizeActiveDispatch(capability.grant, request)
    else capability.store.authorize(capability.grant, request)
  }
  const requireActiveCapabilityDispatch = (
    name: string,
    input: Record<string, unknown>,
    target?: { workspaceId: string; tabId?: string; origins?: string[] }
  ): McpCapabilityProfile | undefined => {
    assertAutomationAccess?.()
    requireAgentControl(name, input, target?.tabId)
    if (!capability) return undefined
    return capability.store.authorizeActiveDispatch(capability.grant, capabilityRequest(name, input, target))
  }
  const capabilityAllowsUrl = (profile: McpCapabilityProfile | undefined, url: string): boolean => {
    if (!profile?.origins) return true
    try {
      const parsed = new URL(url)
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && profile.origins.includes(parsed.origin)
    } catch {
      return false
    }
  }
  // The settlement of the call in progress, for checks that run outside its wrapper.
  const frameRequests = new AsyncLocalStorage<{ settlement?: ToolCallSettlement }>()
  const rememberInputPolicy = (error: unknown): void => {
    frameRequests.getStore()?.settlement?.rememberInputPolicy?.(error)
  }
  // What a call acts on, for the shell's plain-words steps only: the name Hronaut's own snapshot of the page
  // showed for the control it names by ref, or the host and path of a page it opens. Never a selector,
  // typed text, query or anything the agent wrote, and a lookup that fails never fails the call.
  const agentCallTarget = (name: string, input: Record<string, unknown>, workspaceId: string): string | undefined => {
    try {
      const target = toolOptions.get(name)?.stepTarget?.(input)
      if (!target) return undefined
      if ('url' in target) {
        // Search terms name no page: the search engine is the user's, so the step keeps its general phrase.
        const address = typeof target.url === 'string' && target.url.trim() ? webAddress(target.url) : undefined
        return address ? agentStepAddress(address) : undefined
      }
      return typeof target.ref === 'string' ? manager.agentStepName(workspaceId, typeof input.tabId === 'string' ? input.tabId : undefined, target.ref) : undefined
    } catch {
      return undefined
    }
  }
  // Each call in a workspace this client may use shows it in that workspace's
  // toolbar, whatever the tool; a refused call shows no one.
  const startAgentCall = (name: string, input: unknown): ((failed: boolean) => void) | undefined => {
    if (!onAgentCall || !input || typeof input !== 'object' || Array.isArray(input)) return undefined
    const { workspaceId, tabId } = input as { workspaceId?: unknown; tabId?: unknown }
    if (typeof workspaceId !== 'string' || !activeWorkspaceIds.has(workspaceId) || !manager.isWorkspaceAgentAccessible(workspaceId)) return undefined
    const target = agentCallTarget(name, input as Record<string, unknown>, workspaceId)
    const call = { activityId: randomUUID(), toolName: name, source: 'call' as const, ...(typeof tabId === 'string' ? { tabId } : {}), ...(target ? { target } : {}) }
    onAgentCall({ ...call, phase: 'started', occurredAt: Date.now() }, workspaceId)
    return (failed) => onAgentCall({ ...call, phase: failed ? 'failed' : 'finished', occurredAt: Date.now() }, workspaceId)
  }
  const trackAgentCall = async <R>(name: string, input: unknown, run: () => Promise<R>): Promise<R> => {
    const finish = startAgentCall(name, input)
    if (!finish) return run()
    let failed = true
    try {
      const result = await run()
      failed = (result as { isError?: unknown } | undefined)?.isError === true
      return result
    } finally {
      finish(failed)
    }
  }
  // A tool's settlement, when it has one, is created per call before admission (see ToolCallSettlement).
  const registerToolWithSettlement = (
    name: string,
    config: unknown,
    handler: unknown,
    options: ToolOptions<ToolCallSettlement | undefined> = {}
  ): ReturnType<typeof baseRegisterTool> => {
    implementedToolNames.push(name)
    toolOptions.set(name, options)
    if (options.singleTabControl) singleTabControlTools.add(name)
    const definition = toolDefinition(name)
    const registered = baseRegisterTool(name, {
      ...(config as Record<string, unknown>),
      title: definition.title,
      annotations: definition.annotations
    } as never, (async (...args: unknown[]) => trackAgentCall(name, args[0], () => frameRequests.run({}, async () => {
      const input = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? args[0] as Record<string, unknown> : {}
      const frameRequest = frameRequests.getStore()!
      const settlement = options.settlement?.(input)
      frameRequest.settlement = settlement
      const recordReadinessProbe = (outcome: 'verified' | 'failed'): void => {
        if (!options.recordsReadiness?.(input)) return
        // Only browser_status and browser_snapshot declare recordsReadiness.
        client.readinessProbe = { toolName: name as NonNullable<McpClientActivity['readinessProbe']>['toolName'], outcome, completedAt: new Date().toISOString() }
      }
      let finishWorkspaceMutation: (() => void) | undefined
      try {
        const admission = settlement?.admit?.()
        if (admission) return admission
        requireAgentControl(name, input)
        await authorizeCapability(name, input, 'admission')
        await authorizeAutomation?.()
        const leaseExempt = options.leaseExempt?.(input) === true
        const leaseTarget = options.leaseTarget?.(input)
        const leaseWorkspaceId = typeof input.workspaceId === 'string'
          ? input.workspaceId
          : typeof leaseTarget?.workspaceId === 'string'
            ? leaseTarget.workspaceId
            : undefined
        const targetsSavedWorkspace = leaseTarget?.saved === true
        const authorizedLeaseWorkspace = leaseWorkspaceId !== undefined
          && (targetsSavedWorkspace ? savedWorkspaceIds : activeWorkspaceIds).has(leaseWorkspaceId)
          && manager.isWorkspaceAgentAccessible(leaseWorkspaceId)
        if (authorizedLeaseWorkspace && targetsSavedWorkspace
          && workspaceLeases.status(leaseWorkspaceId, client.id).status === 'unclaimed') {
          workspaceLeases.claim(leaseWorkspaceId, client.id)
        }
        if (leaseWorkspaceId && authorizedLeaseWorkspace
          && requiresWorkspaceWriteLease(name, input, leaseExempt)) {
          finishWorkspaceMutation = workspaceLeases.beginMutation(leaseWorkspaceId, client.id)
        }
        await authorizeCapability(name, input, 'consume')
        assertAutomationAccess?.()
        requireAgentControl(name, input)
        const result = await actionTracker.run(() => agentControlContext.run(
          () => { if (!singleTabControlTools.has(name)) requireAgentControl(name, input) },
          () => (handler as (...input: unknown[]) => Promise<CallToolResult>)(...args)
        ))
        try {
          await authorizeCapability(name, settlement?.capabilityInput?.(input) ?? input, 'active-dispatch')
        } catch (error) {
          rememberInputPolicy(error)
          const revoked = settlement?.publicationRevoked?.(error, result)
          if (revoked) {
            recordReadinessProbe('failed')
            return revoked
          }
          if (!(error instanceof McpCapabilityAuthorizationError)) throw error
          const readOnly = mcpCapabilityOperationClass(name, input) === 'read'
          const outcome = {
            status: readOnly ? 'STALE_OBSERVATION' : 'OUTCOME_UNKNOWN',
            effects: readOnly ? 'none' : 'possible',
            permission: 'denied',
            policyDecision: error.decision,
            dispatch: 'dispatched',
            postcondition: readOnly ? 'not-established' : 'unknown',
            reconciliationRequired: !readOnly,
            retrySafe: false,
            nextAction: readOnly
              ? 'The capability changed while this observation was running. Obtain a fresh credential before reading again.'
              : 'The capability changed after dispatch. Inspect current state before deciding what to do next; do not automatically repeat a possible side effect.'
          }
          const settledDenial = settlement?.settleDenied?.({ ...textResult(outcome), structuredContent: outcome, isError: true }, outcome)
          if (settledDenial) return settledDenial
          return { ...textResult(outcome), structuredContent: outcome, isError: true }
        }
        const published = settlement?.publish?.(result)
        const publication = published instanceof Promise ? await published : published
        if (publication) {
          recordReadinessProbe(publication.isError ? 'failed' : 'verified')
          return publication // No await after the tool's final publication check.
        }
        recordReadinessProbe(result.isError ? 'failed' : 'verified')
        return result
      } catch (error) {
        if (error instanceof McpCapabilityAuthorizationError && humanWaiting
          && typeof input.workspaceId === 'string' && typeof input.reviewId === 'string'
          && typeof input.reviewRevision === 'string') {
          try {
            await humanWaiting.invalidateApprovedReview(input.workspaceId, input.reviewId, input.reviewRevision)
          } catch { /* A missing, stale, or already invalidated review does not change the capability denial. */ }
        }
        recordReadinessProbe('failed')
        const settledError = settlement?.settleError?.(error)
        if (settledError) return settledError
        return errorResult(error)
      } finally {
        settlement?.dispose?.()
        const completion = settlement?.pendingCompletion?.()
        if (completion && finishWorkspaceMutation) {
          // Cancellation returns a bounded response but cannot release the writer
          // while queued/submitted native work and its cleanup remain owned.
          void completion.then(finishWorkspaceMutation, finishWorkspaceMutation)
        } else finishWorkspaceMutation?.()
      }
    }))) as never)
    if (toolSetToolNames.has(name)) registeredToolNames.push(name)
    else registered.disable()
    return registered
  }
  const registerTool = ((name: string, config: unknown, handler: unknown, options?: ToolOptions<ToolCallSettlement | undefined>) =>
    registerToolWithSettlement(name, config, handler, options)) as McpToolContext['registerTool']
  const activeWorkspaceIds = new Set<string>()
  const savedWorkspaceIds = new Set<string>()
  const workspaceAuthorizationError = (): Error => new Error(
    'Workspace is not authorized for this MCP client. Create a fresh workspace or resume your own workspace with its private resume key.'
  )
  const withResumeKey = <T extends { id: string }>(workspace: T): T & { resumeKey: string } => ({
    ...workspace,
    resumeKey: manager.mcpWorkspaceResumeKey(workspace.id)
  })
  const leaseLostAfterDispatch = (error: unknown): CallToolResult => {
    if (!(error instanceof WorkspaceWriteLeaseError)) throw error
    const outcome = {
      status: 'OUTCOME_UNKNOWN', reason: 'LEASE_LOST', leaseMode: 'exclusive-write',
      dispatch: 'dispatched', effects: 'possible', retrySafe: false,
      nextAction: 'Inspect the workspace before deciding what to do next. Do not automatically repeat the operation.'
    }
    return { ...textResult(outcome), structuredContent: outcome, isError: true }
  }
  const authorizedActiveWorkspaces = (): ReturnType<BrowserTabsManager['listMcpTabGroups']> => (
    manager.listMcpTabGroups().filter((workspace) => activeWorkspaceIds.has(workspace.id) && manager.isWorkspaceAgentAccessible(workspace.id))
  )
  const authorizedSavedWorkspaces = (): ReturnType<BrowserTabsManager['listSavedTabGroups']> => (
    manager.listSavedTabGroups().filter((workspace) => savedWorkspaceIds.has(workspace.id) && manager.isWorkspaceAgentAccessible(workspace.id))
  )
  const forkOnlySource = (source: ReturnType<BrowserTabsManager['listWorkspaceForkSources']>[number]) => ({
    ...source,
    forkOnly: true as const,
    forkWith: { action: 'create' as const, storage: 'fork-workspace' as const, sourceWorkspaceId: source.id }
  })
  const authorizeResume = (workspaceId: string, resumeKey: string, saved: boolean): void => {
    if (!manager.isWorkspaceAgentAccessible(workspaceId)) throw workspaceAuthorizationError()
    let expected: string
    try {
      expected = manager.mcpWorkspaceResumeKey(workspaceId)
    } catch {
      throw workspaceAuthorizationError()
    }
    if (!matchesWorkspaceResumeKey(expected, resumeKey)) throw workspaceAuthorizationError()
    if (saved) {
      if (!manager.listSavedTabGroups().some((workspace) => workspace.id === workspaceId)) {
        throw workspaceAuthorizationError()
      }
      savedWorkspaceIds.add(workspaceId)
      return
    }
    manager.requireMcpTabGroup(workspaceId)
    activeWorkspaceIds.add(workspaceId)
  }
  const requireAgentWorkspace = (workspaceId: string): ReturnType<BrowserTabsManager['requireMcpTabGroup']> => {
    agentControlContext.getStore()?.()
    if (!activeWorkspaceIds.has(workspaceId) || !manager.isWorkspaceAgentAccessible(workspaceId)) throw workspaceAuthorizationError()
    const workspace = manager.requireMcpTabGroup(workspaceId)
    return workspace
  }
  const requireSavedWorkspace = (workspaceId: string): void => {
    agentControlContext.getStore()?.()
    if (!savedWorkspaceIds.has(workspaceId) || !manager.isWorkspaceAgentAccessible(workspaceId)) throw workspaceAuthorizationError()
  }

  const workspaceToolInputSchemas = new Map<string, z.ZodObject<Record<string, z.ZodType>>>()
  const humanReviewSessionBinding = createHash('sha256')
    .update('hronaut-human-review-session-v1\0')
    .update(randomUUID())
    .digest('hex')
  const publicOutcomeFingerprintKey = randomBytes(32)
  const argumentNormalizers = new Map<string, (args: Record<string, unknown>) => Record<string, unknown>>()
  const reviewedActionArguments = (input: Record<string, unknown>, toolName?: string): Record<string, unknown> => {
    const { reviewId: _reviewId, reviewRevision: _reviewRevision, ...arguments_ } = input
    const normalize = toolName === undefined ? undefined : argumentNormalizers.get(toolName)
    return normalize ? normalize(arguments_) : arguments_
  }
  const reviewBinding = (name: string, input: Record<string, unknown>): HumanWaitingReviewBinding | undefined => {
    if (typeof input.reviewId !== 'string' || typeof input.reviewRevision !== 'string') return undefined
    const workspaceId = input.workspaceId
    if (typeof workspaceId !== 'string') return undefined
    const state = manager.getMcpGroupState(workspaceId)
    const tabId = typeof input.tabId === 'string' ? input.tabId : state.activeTabId ?? undefined
    const tab = tabId ? state.tabs.find(candidate => candidate.id === tabId) : undefined
    let origin: string | undefined
    if (tab) {
      try {
        const url = new URL(tab.url)
        origin = url.origin === 'null' ? url.protocol : url.origin
      } catch { /* A malformed current URL cannot match a persisted reviewed origin. */ }
    }
    return {
      id: input.reviewId,
      revision: input.reviewRevision,
      toolName: name,
      artifactHash: humanWaitingArtifactHash(name, reviewedActionArguments(input, name)),
      sessionBinding: humanReviewSessionBinding,
      ...(origin ? { origin } : {}),
      ...(tab ? {
        tabId: tab.id,
        navigationGeneration: tab.navigationGeneration,
        humanInputGeneration: tab.humanInteractionGeneration ?? 0,
        browserSessionGeneration: tab.browserSessionGeneration ?? 0
      } : {})
    }
  }
  const registerWorkspaceTool = <T extends object, S extends ToolCallSettlement | undefined = undefined>(name: string, config: {
    description?: string
    inputSchema?: Record<string, z.ZodType>
  }, handler: WorkspaceToolHandler<T, S>, options: WorkspaceToolOptions<S> = {}): void => {
    const inputSchema: Record<string, z.ZodType> = {
      workspaceId: workspaceIdSchema.describe('Stable UUIDv7 id returned by your own browser_workspaces create call or by reopening your own archive. After reconnecting, resume that workspace with its private resume key before using page tools.'),
      reviewId: z.uuid().optional().describe('Approved consequential-review ID. Supply it together with reviewRevision only for the exact proposed action.'),
      reviewRevision: z.uuid().optional().describe('Current approved consequential-review revision. The pair is single-use and bound to this exact normalized call.'),
      ...(config.inputSchema ?? {})
    }
    if (options.tabTarget !== 'none') singleTabControlTools.add(name)
    const schema = options.inputSchema?.(inputSchema) ?? z.object(inputSchema)
    workspaceToolInputSchemas.set(name, schema)
    if (options.normalizeArguments) argumentNormalizers.set(name, options.normalizeArguments)
    registerToolWithSettlement(
      name,
      {
        ...config,
        inputSchema: options.inputSchema ? schema : inputSchema
      },
      tool(async (input: Record<string, unknown>, extra) => {
        const preservePresentation = options.preservesPresentation?.(input) === true
        const settlement = frameRequests.getStore()!.settlement as S
        const controlRevision = actionTracker.controlRevision
        const requireCurrentControl = (settled = false): void => {
          if (actionTracker.controlRevision !== controlRevision) {
            throw new Error('MCP control changed before tool dispatch. Inspect the page and obtain fresh state before continuing; earlier page wake or navigation is not rolled back.')
          }
          if (!settled || !options.closesTargetTab) requireAgentControl(name, input, resolvedTabId)
        }
        const workspaceId = input.workspaceId
        if (typeof workspaceId !== 'string') throw new TypeError('workspaceId is required. Create your own workspace with browser_workspaces first and use only its returned ID.')
        if ((typeof input.reviewId === 'string') !== (typeof input.reviewRevision === 'string')) {
          throw new Error('reviewId and reviewRevision must be supplied together')
        }
        const hasReviewedBinding = typeof input.reviewId === 'string'
        if (hasReviewedBinding && !humanWaiting) throw new Error('Human waiting storage is unavailable')
        const actionInput = reviewedActionArguments(input, name)
        const readOnly = toolDefinition(name).annotations.readOnlyHint || options.readOnly?.(actionInput) === true
        const continuityInspection = options.continuityInspection?.(actionInput) === true
        requireActiveCapabilityDispatch(name, actionInput)
        const workspace = requireAgentWorkspace(workspaceId)
        const writeLease = requiresWorkspaceWriteLease(name, actionInput, options.leaseExempt?.(actionInput) === true)
          ? workspaceLeases.require(workspaceId, client.id)
          : undefined
        if (workspace.contextClass === 'public-observer' && !publicObserverAllowsTool(name, options.publicObserverAllowed === true)) {
          throw new Error(`Tool ${name} is unavailable in a read-only public observer workspace`)
        }
        const reviewedBinding = reviewBinding(name, input)
        const requireHumanDecision = async (
          withReviewedBinding = true,
          settlingReviewAttemptId?: string
        ): Promise<void> => {
          if (humanWaiting && !continuityInspection) {
            await humanWaiting.requireDispatch(
              workspaceId,
              () => { requireAgentWorkspace(workspaceId) },
              withReviewedBinding ? reviewedBinding : undefined,
              humanReviewSessionBinding,
              settlingReviewAttemptId
            )
          }
        }
        await requireHumanDecision()
        requireAgentWorkspace(workspaceId)
        const requireContinuity = (): void => {
          if (!continuityInspection) manager.requireWorkspaceContinuityDispatch(workspaceId)
        }
        // Target resolution can change the group's selected tab. Check first.
        requireContinuity()
        const requestedTabId = typeof input.tabId === 'string' ? input.tabId : undefined
        const skipsTabTarget = options.tabTarget === 'none'
          || (options.tabTarget === 'optional' && requestedTabId === undefined)
          || (options.tabTarget === 'if-any'
            && requestedTabId === undefined
            && manager.getMcpGroupState(workspaceId).tabs.length === 0)
        const resolvedTabId = skipsTabTarget
          ? undefined
          : preservePresentation ? manager.requireTabInMcpGroup(workspaceId, requestedTabId, true) : manager.requireTabInMcpGroup(workspaceId, requestedTabId)
        const definition = toolDefinition(name)
        const actionTarget = browserActionTarget(actionInput)
        const actionPayloadFingerprint = browserActionPayloadFingerprint(actionInput)
        const actionAuthority = definition.annotations.destructiveHint && resolvedTabId
          ? captureBrowserActionAuthority({
              state: manager.getMcpGroupState(workspaceId), workspaceId, tabId: resolvedTabId,
              operationClass: browserActionOperationClass(name), target: actionTarget, targetId: randomUUID(),
              authorizationFingerprint: capabilityAuthorizationFingerprint,
              payloadFingerprint: actionPayloadFingerprint
            })
          : undefined
        const postWrite = options.postcondition?.(actionInput)
        const reconciliation = options.reconciliation?.(actionInput)
        if (postWrite && (!resolvedTabId || !auditReceipts?.isRecording(workspaceId))) {
          throw new Error('Post-write verification requires an active browser_audit_receipts run and a page tab target')
        }
        if (reconciliation && (!resolvedTabId || !postWrite)) {
          throw new Error('Pre-write reconciliation requires a page tab target and postcondition')
        }
        if (reconciliation && postWrite && (
          reconciliation.expectedOrigin !== postWrite.expectedOrigin
          || reconciliation.accountSelector !== postWrite.accountSelector
          || reconciliation.expectedAccount !== postWrite.expectedAccount
          || reconciliation.stateSelector !== postWrite.stateSelector
          || reconciliation.expectedText !== postWrite.expectedText
        )) throw new Error('Pre-write reconciliation and postcondition must describe the same authoritative target')
        const postWriteCondition: BrowserPostcondition | undefined = postWrite ? {
          expectedOrigin: postWrite.expectedOrigin,
          accountSelector: postWrite.accountSelector,
          expectedAccount: postWrite.expectedAccount,
          stateSelector: postWrite.stateSelector,
          expectedText: postWrite.expectedText
        } : undefined
        const postWriteFingerprint = postWriteCondition && resolvedTabId
          ? manager.postWriteContextFingerprint(workspaceId, resolvedTabId, postWriteCondition) : undefined
        const requirePostWriteContext = (): void => {
          if (postWriteCondition && resolvedTabId && postWriteFingerprint
            && manager.postWriteContextFingerprint(workspaceId, resolvedTabId, postWriteCondition) !== postWriteFingerprint) {
            throw new Error('Post-write verification context changed before tool dispatch')
          }
        }
        const currentHumanInteractionGeneration = (): number | undefined => resolvedTabId
          ? manager.getMcpGroupState(workspaceId).tabs.find(tab => tab.id === resolvedTabId)?.humanInteractionGeneration
          : undefined
        const humanInteractionGeneration = currentHumanInteractionGeneration()
        const requireCurrentHumanInput = (): void => {
          if (currentHumanInteractionGeneration() !== humanInteractionGeneration) {
            throw new Error('Human input changed the target page during this tool. Obtain fresh state before continuing; earlier effects are not rolled back.')
          }
        }
        const activityToolName = resolvedTabId ? handler.tabActivityToolName : undefined
        const activityId = activityToolName ? randomUUID() : undefined
        const requireCurrentTarget = (): void => {
          if (writeLease?.generation) workspaceLeases.require(workspaceId, client.id, writeLease.generation)
          requireActiveCapabilityDispatch(name, actionInput, settlement?.authorizesResolvedTab ? {workspaceId, tabId: resolvedTabId} : undefined)
          if (settlement?.cancelledMessage && extra?.signal?.aborted) throw new Error(settlement.cancelledMessage)
          requireContinuity()
          requireCurrentControl()
          requireCurrentHumanInput()
          requireAgentWorkspace(workspaceId)
          if (resolvedTabId && !manager.tabBelongsToMcpGroup(workspaceId, resolvedTabId)) {
            throw workspaceAuthorizationError()
          }
        }
        let invalidatedOutcome: 'outcome-unknown' | 'stale-observation' | 'provenance-rejected' | undefined
        let authorityReason: BrowserActionAuthorityReason | undefined
        let activityStarted = false
        let activityDispatched = false
        let verificationResult: { status: string; reason: string; attempt: number } | undefined
        const authorityRejection = (): CallToolResult | undefined => {
          if (!actionAuthority || !resolvedTabId) return undefined
          let state: BrowserState
          try {
            state = manager.getMcpGroupState(workspaceId)
          } catch {
            authorityReason = 'WORKSPACE_CHANGED'
          }
          if (!authorityReason) {
            let permitted = true
            try {
              requireActiveCapabilityDispatch(name, actionInput)
              requireAgentWorkspace(workspaceId)
            } catch { permitted = false }
            authorityReason = browserActionAuthorityReason({
              expected: actionAuthority, state: state!, workspaceId, tabId: resolvedTabId,
              target: browserActionTarget(actionInput), permitted,
              authorizationFingerprint: capabilityAuthorizationFingerprint,
              payloadFingerprint: browserActionPayloadFingerprint(actionInput)
            })
          }
          if (!authorityReason) return undefined
          invalidatedOutcome = 'provenance-rejected'
          const status = authorityReason === 'TARGET_CHANGED' ? 'UNTRUSTED_TARGET'
            : authorityReason === 'WORKSPACE_CHANGED' || authorityReason === 'PERMISSION_CHANGED'
                || authorityReason === 'SITE_POLICY_CHANGED' ? 'POLICY_REJECTED' : 'STALE_PRECONDITION'
          const outcome = {
            status, reason: authorityReason, effects: 'none', retrySafe: true,
            nextAction: 'Inspect the current visible page and obtain fresh runtime state before issuing a new action.'
          }
          return { ...textResult(outcome), structuredContent: outcome, isError: true }
        }
        let reviewAttempt: { id: string; revision: string } | undefined
        let preWriteReconciliation: PublicBrowserReconciliation | undefined
        const finishReviewedAttempt = async (outcome: 'verified' | 'unknown'): Promise<import('../../shared/human-waiting.js').HumanWaitingRecord | undefined> => {
          if (!reviewAttempt || !humanWaiting) return
          const attempt = reviewAttempt
          reviewAttempt = undefined
          try {
            return await humanWaiting.finishReviewedDispatch(workspaceId, attempt.id, attempt.revision, outcome, () => {
              requireAgentWorkspace(workspaceId)
            })
          } catch (error) {
            settlement?.reviewFinalizationFailed?.()
            finishActivity(undefined, true, error)
            throw error
          }
        }
        // Set only by the main-process recorder, never by caller arguments or report data.
        let lifecycleOrigin: string | undefined
        const validateLifecycle = (origin: string): void => {
          if (extra?.signal?.aborted) throw new Error('Worker observation was cancelled')
          requireCurrentControl()
          requireCurrentHumanInput()
          requireContinuity()
          requireAgentWorkspace(workspaceId)
          // Background observation must not renew the creating transport's lease.
          if (writeLease?.generation) {
            const current = workspaceLeases.status(workspaceId, client.id)
            if (current.status !== 'owned' || current.generation !== writeLease.generation) throw new Error('Workspace ownership changed')
          }
          if (resolvedTabId && !manager.tabBelongsToMcpGroup(workspaceId, resolvedTabId)) throw workspaceAuthorizationError()
          requireActiveCapabilityDispatch(name, actionInput, { workspaceId, tabId: resolvedTabId, origins: [origin] })
          lifecycleOrigin = origin
        }
        const validateLifecycleResult = (): void => {
          if (lifecycleOrigin !== undefined) validateLifecycle(lifecycleOrigin)
        }
        // What a tool may re-check while it runs. Each tool builds its own hooks from these.
        const call: WorkspaceToolCall<S> = {
          input: actionInput,
          workspaceId,
          tabId: resolvedTabId,
          signal: extra?.signal,
          controlRevision,
          writeLeaseGeneration: writeLease?.generation,
          requireCurrentTarget,
          requirePostWriteContext,
          requireCurrentControl,
          requireCurrentHumanInput,
          authorityRejection,
          rememberInputPolicy,
          setInvalidatedOutcome: outcome => { invalidatedOutcome = outcome },
          validateLifecycle,
          settlement
        }
        settlement?.prepare?.(call)
        const operation = async (): Promise<CallToolResult> => {
          const admissionRejection = authorityRejection()
          if (admissionRejection) return admissionRejection
          requireCurrentTarget()
          requirePostWriteContext()
          if (reconciliation && resolvedTabId) {
            const condition: BrowserReconciliationCondition = {
              mode: reconciliation.mode,
              expectedOrigin: reconciliation.expectedOrigin,
              accountSelector: reconciliation.accountSelector,
              expectedAccount: reconciliation.expectedAccount,
              stateSelector: reconciliation.stateSelector,
              expectedText: reconciliation.expectedText,
              ...(reconciliation.expectedCurrentText !== undefined
                ? { expectedCurrentText: reconciliation.expectedCurrentText } : {})
            }
            const evidence = await manager.readBrowserReconciliation(
              workspaceId, resolvedTabId, condition, requireCurrentTarget, extra?.signal
            )
            requireCurrentTarget()
            requirePostWriteContext()
            preWriteReconciliation = publicBrowserReconciliation(reconciliation, evidence)
            if (!preWriteReconciliation.actionable) {
              const alreadyPresent = preWriteReconciliation.status === 'already_present'
              const outcome = {
                status: alreadyPresent ? 'SKIPPED_ALREADY_PRESENT' : 'RECONCILIATION_BLOCKED',
                retrySafe: false,
                preWriteReconciliation,
                nextAction: alreadyPresent
                  ? 'Treat the authoritative target as already satisfied; do not dispatch or retry this write.'
                  : 'Inspect the authoritative target and prepare a fresh reconciliation before deciding whether to write.'
              }
              return { ...textResult(outcome), structuredContent: outcome, ...(!alreadyPresent ? { isError: true } : {}) }
            }
          }
          if (activityId && activityToolName && resolvedTabId) {
            activityStarted = true
            onTabActivity?.({
              activityId,
              tabId: resolvedTabId,
              toolName: activityToolName,
              phase: 'started',
              ...(preservePresentation ? { suppressFollow: true } : {}),
              occurredAt: Date.now()
            }, workspaceId)
          }
          const finishContinuityAction = manager.beginWorkspaceContinuityAction(workspaceId, readOnly)
          try {
            if (!preservePresentation && resolvedTabId && (handler.resolvedTargetWakePolicy ?? 'before-handler') === 'before-handler') {
              await manager.wakeTab(resolvedTabId)
            }
            // Audit admission and tab wake can outlive pause, access revocation,
            // or a human moving the target into a different workspace.
            await requireHumanDecision()
            const dispatchRejection = authorityRejection()
            if (dispatchRejection) return dispatchRejection
            requireCurrentTarget()
            requirePostWriteContext()
            if (reviewedBinding && humanWaiting) {
              const attempted = await humanWaiting.beginReviewedDispatch(
                workspaceId,
                () => {
                  const current = reviewBinding(name, input)
                  if (!current) throw new Error('Reviewed action binding is unavailable')
                  return current
                },
                () => { requireAgentWorkspace(workspaceId) },
                () => { requireCurrentTarget(); requirePostWriteContext() }
              )
              reviewAttempt = { id: attempted.id, revision: attempted.revision }
            }
            if (settlement?.certify) await settlement.certify(humanWaiting ? () => humanWaiting.certifyDispatch(
              workspaceId, () => { requireAgentWorkspace(workspaceId) }, undefined, humanReviewSessionBinding, reviewAttempt?.id
            ) : undefined)
            settlement?.beforeDispatch?.()
            activityDispatched = true
            const result = options.tabTarget === 'none'
              ? await handler(actionInput as unknown as T, call)
              : await handler({ ...actionInput, tabId: resolvedTabId } as unknown as T, call)
            settlement?.afterDispatch?.(result)
            try {
              if (invalidatedOutcome === 'outcome-unknown') throw new Error('Action authority changed during dispatch')
              await requireHumanDecision(false, reviewAttempt?.id)
              settlement?.recheckAfterDispatch?.()
              validateLifecycleResult()
              if (writeLease?.generation) workspaceLeases.require(workspaceId, client.id, writeLease.generation)
              requireCurrentControl(true)
              requireAgentWorkspace(workspaceId)
              if (!options.closesTargetTab) requireCurrentHumanInput()
              // Closing a tab intentionally retires its target. Other tools
              // must still belong to the authorized workspace when they settle.
              if (resolvedTabId && !options.closesTargetTab
                && !manager.tabBelongsToMcpGroup(workspaceId, resolvedTabId)) throw workspaceAuthorizationError()
            } catch (error) {
              rememberInputPolicy(error)
              invalidatedOutcome = readOnly ? 'stale-observation' : 'outcome-unknown'
              const outcome = {
                status: readOnly ? 'STALE_OBSERVATION' : 'OUTCOME_UNKNOWN',
                retrySafe: false,
                nextAction: 'The workspace context changed while this tool was running. Its result was discarded. Inspect the visible page and obtain fresh state before deciding what to do next; do not automatically repeat a possible side effect.'
              }
              await finishReviewedAttempt('unknown')
              return { ...textResult(outcome), structuredContent: outcome, isError: true }
            }
            const scoped = scopeBrowserStateResult(result, manager.getMcpGroupState(workspaceId))
            if (scoped.isError) await finishReviewedAttempt('unknown')
            return preWriteReconciliation ? withPreWriteReconciliation(scoped, preWriteReconciliation) : scoped
          } catch (error) {
            if (!(error instanceof NativeInputCleanupError) && !(error instanceof NativeWheelOutcomeUnknownError)) throw error
            const uncertainResult = error instanceof NativeClickAdmissionError
              ? (failed = false) => nativeClickFailureResult(error.progress, error.reason, failed, settlement?.inputPolicy?.())
              : error instanceof NativeKeyHoldOutcomeUnknownError
              ? (failed = false) => nativeKeyHoldUnknownResult(error.progress, failed)
              : error instanceof NativeWheelOutcomeUnknownError ? nativeWheelUnknownResult : nativeInputCleanupResult
            invalidatedOutcome = 'outcome-unknown'
            try {
              await finishReviewedAttempt('unknown')
            } catch {
              // Authorization/persistence failure must remain visible without
              // replacing the no-replay contract for acknowledged native input.
              return uncertainResult(true)
            }
            return uncertainResult()
          } finally {
            finishContinuityAction()
          }
        }
        const finishActivity = (result: CallToolResult | undefined, threw: boolean, error?: unknown): void => {
          if (settlement?.deferActivity?.(settled => finishActivity(settled, false))) return
          if (!activityStarted || !activityId || !activityToolName || !resolvedTabId) return
          activityStarted = false
          const structured = result?.structuredContent
          const status = structured && typeof structured === 'object' && !Array.isArray(structured)
            && typeof structured.status === 'string' ? structured.status : undefined
          const classification: ToolActivityClassification = {
            readOnly,
            dispatched: activityDispatched,
            invalidatedOutcome
          }
          const classified = settlement?.classifyActivity?.(classification, threw || result?.isError === true, result) ?? classification
          const activityResult = classifyMcpActivityResult({
            readOnly: classified.readOnly,
            dispatched: classified.dispatched,
            cancelled: extra?.signal?.aborted === true,
            timedOut: isTimeoutError(error),
            threw,
            isError: result?.isError === true,
            status,
            invalidatedOutcome: classified.invalidatedOutcome,
            verificationStatus: verificationResult?.status
          })
          onTabActivity?.({
            activityId,
            tabId: resolvedTabId,
            toolName: activityToolName,
            phase: activityResult.outcome === 'succeeded' ? 'finished' : 'failed',
            ...(preservePresentation ? { suppressFollow: true } : {}),
            occurredAt: Date.now(),
            result: activityResult
          }, workspaceId)
        }
        const invalidatedWaitResult = (error: unknown): CallToolResult | undefined => {
          if (!activityStarted || !resolvedTabId || !options.waitsOnTab) {
            return undefined
          }
          return closedTabWaitResult(error, !manager.tabBelongsToMcpGroup(workspaceId, resolvedTabId))
        }
        if (!auditReceipts || !name.startsWith('browser_')) {
          try {
            const result = await operation()
            validateLifecycleResult()
            finishActivity(result, false)
            return result
          } catch (error) {
            rememberInputPolicy(error)
            await finishReviewedAttempt('unknown')
            const invalidated = invalidatedWaitResult(error)
            if (invalidated) {
              finishActivity(invalidated, false)
              return invalidated
            }
            finishActivity(undefined, true, error)
            throw error
          }
        }
        let initialOrigin: string | undefined = actionAuthority?.topLevelOrigin
        const observeAuditState = () => {
          const state = manager.getMcpGroupState(workspaceId)
          const tab = state.tabs.find(tab => tab.id === (resolvedTabId ?? state.activeTabId))
          if (!tab) return null
          const url = new URL(tab.url)
          const origin = url.origin === 'null' ? url.protocol : url.origin
          initialOrigin ??= origin
          return {
            tabId: tab.id,
            navigationGeneration: tab.navigationGeneration,
            observationGeneration: tab.observationGeneration ?? 0,
            humanInteractionGeneration: tab.humanInteractionGeneration ?? 0,
            controlRevision: actionTracker.controlRevision,
            runtimeId: actionTracker.runtimeId,
            writeLease: workspaceLeases.status(workspaceId, client.id),
            originChanged: origin !== initialOrigin,
            ...(actionAuthority ? {
              operationClass: actionAuthority.operationClass,
              targetKind: actionAuthority.targetKind,
              targetId: actionAuthority.targetId,
              ...(authorityReason ? { authorityReason } : {})
            } : {})
          }
        }
        let result: CallToolResult
        try {
          result = await auditReceipts.execute(workspaceId, {
          toolName: name,
          readOnly,
          authorization: auditAuthorization,
          signal: extra?.signal,
          isErrorResult: result => result.isError === true,
          classifyErrorResult: () => settlement?.effectsPossible?.() ? 'outcome-unknown' : invalidatedOutcome,
          observeState: observeAuditState,
          observeEvidence: () => {
            const state = observeAuditState()
            if (!state?.tabId) {
              return {
                state,
                artifacts: ['diagnostic', 'network', 'dom-changes', 'storage-changes', 'reproduction'].map(source => ({
                  source: source as 'diagnostic' | 'network' | 'dom-changes' | 'storage-changes' | 'reproduction',
                  status: 'unsupported' as const, reason: 'no-tab' as const, referenceId: null
                }))
              }
            }
            const availability = manager.auditEvidenceAvailability(state.tabId)
            const missingReason = invalidatedOutcome === 'outcome-unknown' ? 'outcome-unknown' as const : undefined
            const artifact = (source: 'diagnostic' | 'network' | 'dom-changes' | 'storage-changes' | 'reproduction',
              available: boolean, reason: 'recorder-inactive' | 'baseline-missing' | 'unsupported-scheme') => available ? {
                source, status: 'available' as const, reason: 'retained' as const, referenceId: randomUUID()
              } : {
                source, status: reason === 'unsupported-scheme' ? 'unsupported' as const : 'not-collected' as const,
                reason: missingReason ?? reason, referenceId: null
              }
            return {
              state,
              artifacts: [
                artifact('diagnostic', availability.diagnostic, 'recorder-inactive'),
                artifact('network', availability.network, 'recorder-inactive'),
                artifact('dom-changes', availability.domChanges, 'recorder-inactive'),
                artifact('storage-changes', availability.storageChanges,
                  availability.storageSupported ? 'baseline-missing' : 'unsupported-scheme'),
                artifact('reproduction', availability.reproduction, 'recorder-inactive')
              ]
            }
          },
          ...(postWrite && postWriteCondition && postWriteFingerprint && resolvedTabId ? {
            verification: {
              verificationId: randomUUID(), maxAttempts: postWrite.maxAttempts,
              verify: async ({ actionId, signal, append }: {
                actionId: string
                signal?: AbortSignal
                append: (update: AuditVerificationUpdate) => Promise<void>
              }) => {
                const timeline = await runPostWriteVerification({
                  contract: {
                    actionId, transport: 'succeeded', contextFingerprint: postWriteFingerprint,
                    timeoutMs: postWrite.timeoutMs, maxAttempts: postWrite.maxAttempts,
                    initialDelayMs: postWrite.initialDelayMs
                  },
                  signal,
                  read: async readSignal => {
                    await requireHumanDecision(false, reviewAttempt?.id)
                    requireCurrentTarget()
                    return manager.readPostWritePostcondition(
                      workspaceId, resolvedTabId, postWriteCondition, requireCurrentTarget, readSignal
                    )
                  },
                  onEvent: async event => {
                    await append({ attempt: event.attempt, status: event.state, reason: event.reason })
                    verificationResult = { status: event.state, reason: event.reason, attempt: event.attempt }
                  }
                })
                const final = timeline.at(-1)!
                verificationResult = { status: final.state, reason: final.reason, attempt: final.attempt }
              }
            }
          } : {}),
          operation
          })
        } catch (error) {
          rememberInputPolicy(error)
          await finishReviewedAttempt('unknown')
          const invalidated = invalidatedWaitResult(error)
          if (invalidated) {
            finishActivity(invalidated, false)
            return invalidated
          }
          finishActivity(undefined, true, error)
          throw error
        }
        let finalResult = verificationResult ? withPostWriteVerification(result, verificationResult) : result
        if (preWriteReconciliation) {
          finalResult = withReconciliationOutcome(finalResult, {
            status: verificationResult?.status === 'verified' ? 'verified'
              : activityDispatched ? 'reconciliation_required' : 'blocked',
            authoritativeReadback: verificationResult?.status === 'verified' ? 'verified' : 'not-verified',
            dispatch: activityDispatched ? 'dispatched-once' : 'not-dispatched'
          })
        }
        if (verificationResult?.status === 'verified') {
          const completed = await finishReviewedAttempt('verified')
          if (completed?.state === 'RESOLVED' && completed.review?.steps && completed.review.currentStep !== undefined) {
            finalResult = withReviewContinuation(finalResult, {
              id: completed.id,
              revision: completed.revision,
              nextStep: completed.review.currentStep + 1,
              totalSteps: completed.review.steps.length
            })
          }
        }
        else if (verificationResult?.status === 'unknown' || finalResult.isError) await finishReviewedAttempt('unknown')
        validateLifecycleResult()
        finalResult = settlement?.finalize?.(finalResult) ?? finalResult
        finishActivity(finalResult, false)
        return finalResult
      }),
      options
    )
  }

  const requireWallets = (): WalletAgentOperations => {
    if (!wallets) throw new Error('Wallet operations are unavailable')
    return wallets
  }
  const requireWalletSessions = (): WalletAgentSessionRegistry => {
    if (!walletSessions) throw new Error('Wallet agent sessions are unavailable')
    return walletSessions
  }
  const walletTarget = (walletSessionId: string, workspaceId: string, tabId: string): WalletAgentToolTarget => (
    requireWalletSessions().resolve(walletSessionId, workspaceId, tabId, client.id)
  )

  const toolContext: McpToolContext = {
    activeWorkspaceIds,
    auditAuthorization,
    auditReceipts,
    authorizeResume,
    authorizedActiveWorkspaces,
    authorizedSavedWorkspaces,
    bookmarks,
    capability,
    capabilityAllowsUrl,
    capabilityAuthorizationFingerprint,
    capabilityProfile,
    client,
    forkOnlySource,
    getPaused,
    getUserAttention,
    history,
    humanReviewSessionBinding,
    humanWaiting,
    leaseLostAfterDispatch,
    manager,
    onTabActivity,
    publicOutcomeFingerprintKey,
    registerTool,
    registerWorkspaceTool,
    requestUserAttention,
    requireActiveCapabilityDispatch,
    requireAgentWorkspace,
    requireSavedWorkspace,
    requireWalletSessions,
    requireWallets,
    reviewedActionArguments,
    savedTaskPreviewKey,
    savedWorkspaceIds,
    showWindowInactive,
    siteData,
    tabTool,
    taskRuns,
    tool,
    userAttentionLifecycle,
    walletTarget,
    wallets,
    withResolvedTargetWakePolicy,
    withResumeKey,
    workspaceAuthorizationError,
    workspaceToolInputSchemas,
    actionTracker,
    workspaceLeases
  }

  // Each tool registers itself from tools/<tool-name>/index.ts, in this order.
  registerBrowserWorkspaces(toolContext)
  registerBrowserSavedWorkspaces(toolContext)
  registerBrowserHumanWaiting(toolContext)
  registerBrowserContinuity(toolContext)
  registerBrowserPreflight(toolContext)
  registerBrowserAuditReceipts(toolContext)
  registerBrowserTaskRuns(toolContext)
  registerBrowserStatus(toolContext)
  registerBrowserShow(toolContext)
  registerBrowserUserAttention(toolContext)
  registerBrowserRequestUserAttention(toolContext)
  registerBrowserTabs(toolContext)
  registerBrowserNewTab(toolContext)
  registerBrowserSelectTab(toolContext)
  registerBrowserCloseTab(toolContext)
  registerBrowserBookmarks(toolContext)
  registerBrowserVisitHistory(toolContext)
  registerBrowserSiteData(toolContext)
  registerBrowserStorage(toolContext)
  registerBrowserStorageChanges(toolContext)
  registerBrowserStorageUsage(toolContext)
  registerBrowserIndexeddb(toolContext)
  registerBrowserPwaLifecycle(toolContext)
  registerBrowserPwa(toolContext)
  registerBrowserNavigate(toolContext)
  registerBrowserHistory(toolContext)
  registerBrowserSnapshot(toolContext)
  registerBrowserPublicOutcome(toolContext)
  registerBrowserFind(toolContext)
  registerBrowserElementInspect(toolContext)
  registerBrowserMediaState(toolContext)
  registerBrowserImageState(toolContext)
  registerBrowserGenerateLocator(toolContext)
  registerBrowserReconciliation(toolContext)
  registerBrowserClick(toolContext)
  registerBrowserDialog(toolContext)
  registerBrowserType(toolContext)
  registerBrowserSelect(toolContext)
  registerBrowserFillForm(toolContext)
  registerBrowserHover(toolContext)
  registerBrowserDrag(toolContext)
  registerBrowserWheel(toolContext)
  registerBrowserScroll(toolContext)
  registerBrowserHoldKey(toolContext)
  registerBrowserPress(toolContext)
  registerBrowserFileUpload(toolContext)
  registerBrowserWait(toolContext)
  registerBrowserEmulate(toolContext)
  registerBrowserPageLifecycle(toolContext)
  registerBrowserZoom(toolContext)
  registerBrowserAudio(toolContext)
  registerBrowserScreenshot(toolContext)
  registerBrowserPdfSave(toolContext)
  registerBrowserResize(toolContext)
  registerBrowserAccessibilityAudit(toolContext)
  registerBrowserQualityAudit(toolContext)
  registerBrowserPerformance(toolContext)
  registerBrowserDesignOverview(toolContext)
  registerBrowserPageMetadata(toolContext)
  registerBrowserMemory(toolContext)
  registerBrowserSecurity(toolContext)
  registerBrowserReact(toolContext)
  registerBrowserCodeCoverage(toolContext)
  registerBrowserCpuProfile(toolContext)
  registerBrowserDebugReport(toolContext)
  registerBrowserVideo(toolContext)
  registerBrowserRepro(toolContext)
  registerBrowserDomChanges(toolContext)
  registerBrowserLiveRegion(toolContext)
  registerBrowserCssStatePreview(toolContext)
  registerBrowserVisualCompare(toolContext)
  registerBrowserConsole(toolContext)
  registerBrowserDiagnosticLogs(toolContext)
  registerBrowserIssues(toolContext)
  registerBrowserNetwork(toolContext)
  registerBrowserNetworkWait(toolContext)
  registerBrowserNetworkSearch(toolContext)
  registerBrowserNetworkRequest(toolContext)
  registerBrowserNetworkReplay(toolContext)
  registerBrowserNetworkHar(toolContext)
  registerBrowserNetworkRoutes(toolContext)
  registerBrowserDownloads(toolContext)
  registerBrowserWebmcp(toolContext)
  registerBrowserEvaluateFile(toolContext)
  registerBrowserEvaluate(toolContext)
  registerWalletList(toolContext)
  registerWalletBalance(toolContext)
  registerWalletPrepareTransaction(toolContext)
  registerWalletRequest(toolContext)
  registerWalletRequestStatus(toolContext)
  registerWalletPageRequests(toolContext)
  registerWalletCancelRequest(toolContext)

  const previousClose = server.server.onclose
  server.server.onclose = () => {
    for (const workspaceId of activeWorkspaceIds) manager.suspendWorkspaceContinuity(workspaceId)
    previousClose?.()
  }

  assertMcpToolRegistrationContract(BROWSER_TOOL_CATALOG, implementedToolNames)
  assertMcpToolRegistrationContract(toolSetCatalog, registeredToolNames)
  return { server }
}
