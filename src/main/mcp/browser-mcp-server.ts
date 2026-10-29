import { EmulationInputError } from '../browser/emulation-state.js'
import { StorageComparisonInputError } from '../browser/storage-comparison-operation.js'
import { WebStorageInputError } from '../browser/web-storage-operation.js'
import { NativeWheelOutcomeUnknownError } from '../browser/native-wheel.js'
import { NativeInputCleanupError } from '../browser/native-input-cleanup.js'
import type { UserAttentionLifecycle } from '../attention/user-attention-lifecycle.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { requireTabAgentControl } from './tab-agent-control.js'
import { BROWSER_SERVER_INSTRUCTIONS, BROWSER_TOOL_CATALOG, mcpToolCatalogForSet, type BrowserToolDefinition } from './tool-catalog.js'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { AuditReceiptService } from './audit-receipt-service.js'
import type { AuditReceiptAuthorization } from './audit-receipt-store.js'
import type { HumanWaitingReviewBinding, HumanWaitingService } from './human-waiting-service.js'
import { humanWaitingArtifactHash } from './human-waiting-store.js'
import type { TaskRunService } from './task-run-service.js'
import { McpCapabilityAuthorizationError, type McpCapabilityGrant, type McpCapabilityProfile, type McpCapabilityProfileStore, type McpCapabilityRequest } from './capability-profile-store.js'
import { McpActionTracker } from './action-tracker.js'
import { WorkspaceWriteLeaseError, WorkspaceWriteLeaseRegistry } from './workspace-write-leases.js'
import type { AgentCall } from './agent-presence.js'
import { agentStepAddress } from '../../shared/agent-steps.js'
import { webAddress } from '../browser/url.js'
import type { Browser } from '../browser/browser.js'
import type { McpTabActivity, UserAttentionInput, UserAttentionRequest } from '../../shared/types.js'
import type { McpToolSet } from '../../shared/mcp-tool-sets.js'
import { errorResult, textResult, toolDefinition } from './tool-results.js'
import { mcpCapabilityAction, mcpCapabilityOperationClass } from './capability-classification.js'
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
import { registerBrowserTouch } from './tools/browser-touch/index.js'
import { registerBrowserScroll } from './tools/browser-scroll/index.js'
import { registerBrowserHoldKey } from './tools/browser-hold-key/index.js'
import { registerBrowserPress } from './tools/browser-press/index.js'
import { registerBrowserInsertText } from './tools/browser-insert-text/index.js'
import { registerBrowserFillFromFile } from './tools/browser-fill-from-file/index.js'
import { registerBrowserFileUpload } from './tools/browser-file-upload/index.js'
import { registerBrowserFileDrop } from './tools/browser-file-drop/index.js'
import { registerBrowserWait } from './tools/browser-wait/index.js'
import { registerBrowserEmulate } from './tools/browser-emulate/index.js'
import { registerBrowserPageLifecycle } from './tools/browser-page-lifecycle/index.js'
import { registerBrowserZoom } from './tools/browser-zoom/index.js'
import { registerBrowserAudio } from './tools/browser-audio/index.js'
import { registerBrowserScreenshot } from './tools/browser-screenshot/index.js'
import { registerBrowserPdfSave } from './tools/browser-pdf-save/index.js'
import { registerBrowserScreenshotSave } from './tools/browser-screenshot-save/index.js'
import { registerBrowserResize } from './tools/browser-resize/index.js'
import { registerBrowserAccessibilityAudit } from './tools/browser-accessibility-audit/index.js'
import { registerBrowserComputedAccessibility } from './tools/browser-computed-accessibility/index.js'
import { registerBrowserQualityAudit } from './tools/browser-quality-audit/index.js'
import { registerBrowserPerformance } from './tools/browser-performance/index.js'
import { registerBrowserDesignOverview } from './tools/browser-design-overview/index.js'
import { registerBrowserPageMetadata } from './tools/browser-page-metadata/index.js'
import { registerBrowserMemory } from './tools/browser-memory/index.js'
import { registerBrowserSecurity } from './tools/browser-security/index.js'
import { registerBrowserReact } from './tools/browser-react/index.js'
import { registerBrowserFixedDate } from './tools/browser-fixed-date/index.js'
import { registerBrowserCodeCoverage } from './tools/browser-code-coverage/index.js'
import { registerBrowserCpuProfile } from './tools/browser-cpu-profile/index.js'
import { registerBrowserDebugReport } from './tools/browser-debug-report/index.js'
import { registerBrowserVideo } from './tools/browser-video/index.js'
import { registerBrowserRepro } from './tools/browser-repro/index.js'
import { registerBrowserDomChanges } from './tools/browser-dom-changes/index.js'
import { registerBrowserDomMutationSource } from './tools/browser-dom-mutation-source/index.js'
import { registerBrowserLiveRegion } from './tools/browser-live-region/index.js'
import { registerBrowserCssStatePreview } from './tools/browser-css-state-preview/index.js'
import { registerBrowserVirtualPasskey } from './tools/browser-virtual-passkey/index.js'
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
import { registerBrowserDownloadCopy } from './tools/browser-download-copy/index.js'
import { registerBrowserWebmcp } from './tools/browser-webmcp/index.js'
import { registerBrowserEvaluateFile } from './tools/browser-evaluate-file/index.js'
import { registerBrowserEvaluate } from './tools/browser-evaluate/index.js'
import { registerBrowserWorkers } from './tools/browser-workers/index.js'
import { registerBrowserLogpoint } from './tools/browser-logpoint/index.js'
import { registerWalletList } from './tools/wallet-list/index.js'
import { registerWalletBalance } from './tools/wallet-balance/index.js'
import { registerWalletPrepareTransaction } from './tools/wallet-prepare-transaction/index.js'
import { registerWalletRequest } from './tools/wallet-request/index.js'
import { registerWalletRequestStatus } from './tools/wallet-request-status/index.js'
import { registerWalletPageRequests } from './tools/wallet-page-requests/index.js'
import { registerWalletCancelRequest } from './tools/wallet-cancel-request/index.js'
import type { McpToolContext, ResolvedTargetWakePolicy, ToolCallSettlement, ToolOptions, WorkspaceToolCall, WorkspaceToolHandler } from './tools/tool-context.js'
import type { BookmarkOperations, HistoryOperations, SiteDataOperations } from './browser-data-operations.js'
import type { WalletAgentOperations, WalletAgentSessionRegistry, WalletAgentToolTarget } from './wallet-agent-sessions.js'
import type { McpClientActivity } from './http-server.js'
import { createWorkspaceToolRegistrar, requiresWorkspaceWriteLease } from './workspace-tool-call.js'

function matchesWorkspaceResumeKey(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8')
  const suppliedBytes = Buffer.from(supplied, 'utf8')
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes)
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

/**
 * One client session's MCP server: the call wrapper that admits, guards and settles every tool call the same way,
 * the workspace wrapper built in workspace-tool-call.ts, and the tool registrations in order. Each tool lives in
 * tools/<tool>/ and declares what differs about its calls in its registration options and settlement
 * (tools/tool-context.ts). Only McpHttpServer (http-server.ts) creates one, after its authentication, origin and
 * rate-limit checks have admitted the session; nothing else should call it.
 */
export function createBrowserMcpServer(
  manager: Browser,
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
    // Agent control is checked for the workspace and tab the capability check names, which can be a second
    // workspace of the call, never for the target tab against the call's own workspace.
    requireAgentControl(name, target ? { ...input, workspaceId: target.workspaceId } : input, target?.tabId)
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
  const authorizedActiveWorkspaces = (): ReturnType<Browser['listMcpTabGroups']> => (
    manager.listMcpTabGroups().filter((workspace) => activeWorkspaceIds.has(workspace.id) && manager.isWorkspaceAgentAccessible(workspace.id))
  )
  const authorizedSavedWorkspaces = (): ReturnType<Browser['listSavedTabGroups']> => (
    manager.listSavedTabGroups().filter((workspace) => savedWorkspaceIds.has(workspace.id) && manager.isWorkspaceAgentAccessible(workspace.id))
  )
  const forkOnlySource = (source: ReturnType<Browser['listWorkspaceForkSources']>[number]) => ({
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
  const requireAgentWorkspace = (workspaceId: string): ReturnType<Browser['requireMcpTabGroup']> => {
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
  const registerWorkspaceTool = createWorkspaceToolRegistrar({
    actionTracker,
    argumentNormalizers,
    auditAuthorization,
    auditReceipts,
    capabilityAuthorizationFingerprint,
    client,
    frameRequests,
    humanReviewSessionBinding,
    humanWaiting,
    manager,
    onTabActivity,
    registerToolWithSettlement,
    rememberInputPolicy,
    requireActiveCapabilityDispatch,
    requireAgentControl,
    requireAgentWorkspace,
    reviewBinding,
    reviewedActionArguments,
    singleTabControlTools,
    tool,
    workspaceAuthorizationError,
    workspaceLeases,
    workspaceToolInputSchemas
  })

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
  registerBrowserTouch(toolContext)
  registerBrowserScroll(toolContext)
  registerBrowserHoldKey(toolContext)
  registerBrowserPress(toolContext)
  registerBrowserInsertText(toolContext)
  registerBrowserFillFromFile(toolContext)
  registerBrowserFileUpload(toolContext)
  registerBrowserFileDrop(toolContext)
  registerBrowserWait(toolContext)
  registerBrowserEmulate(toolContext)
  registerBrowserPageLifecycle(toolContext)
  registerBrowserZoom(toolContext)
  registerBrowserAudio(toolContext)
  registerBrowserScreenshot(toolContext)
  registerBrowserPdfSave(toolContext)
  registerBrowserScreenshotSave(toolContext)
  registerBrowserResize(toolContext)
  registerBrowserAccessibilityAudit(toolContext)
  registerBrowserComputedAccessibility(toolContext)
  registerBrowserQualityAudit(toolContext)
  registerBrowserPerformance(toolContext)
  registerBrowserDesignOverview(toolContext)
  registerBrowserPageMetadata(toolContext)
  registerBrowserMemory(toolContext)
  registerBrowserSecurity(toolContext)
  registerBrowserReact(toolContext)
  registerBrowserFixedDate(toolContext)
  registerBrowserCodeCoverage(toolContext)
  registerBrowserCpuProfile(toolContext)
  registerBrowserDebugReport(toolContext)
  registerBrowserVideo(toolContext)
  registerBrowserRepro(toolContext)
  registerBrowserDomChanges(toolContext)
  registerBrowserDomMutationSource(toolContext)
  registerBrowserLiveRegion(toolContext)
  registerBrowserCssStatePreview(toolContext)
  registerBrowserVirtualPasskey(toolContext)
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
  registerBrowserDownloadCopy(toolContext)
  registerBrowserWebmcp(toolContext)
  registerBrowserEvaluateFile(toolContext)
  registerBrowserEvaluate(toolContext)
  registerBrowserWorkers(toolContext)
  registerBrowserLogpoint(toolContext)
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
