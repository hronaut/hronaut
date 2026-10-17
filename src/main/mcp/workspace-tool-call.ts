import { NativeClickAdmissionError } from '../browser/native-click-admission.js'
import { NativeWheelOutcomeUnknownError } from '../browser/native-wheel.js'
import { NativeKeyHoldOutcomeUnknownError } from '../browser/native-key-hold.js'
import { NativeInputCleanupError } from '../browser/native-input-cleanup.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { AuditVerificationUpdate } from './audit-receipt-run.js'
import { runPostWriteVerification } from './post-write-verification-runner.js'
import type { BrowserPostcondition } from '../../shared/post-write-postcondition.js'
import type { BrowserReconciliationCondition } from '../../shared/browser-reconciliation.js'
import type { HumanWaitingReviewBinding } from './human-waiting-service.js'
import {
  browserActionAuthorityReason,
  browserActionOperationClass,
  browserActionPayloadFingerprint,
  browserActionTarget,
  captureBrowserActionAuthority,
  type BrowserActionAuthorityReason
} from './browser-action-authority.js'
import type { BrowserState } from '../../shared/types.js'
import { type PublicBrowserReconciliation, classifyMcpActivityResult, closedTabWaitResult, isTimeoutError, mcpWorkspaceState, nativeClickFailureResult, nativeInputCleanupResult, nativeKeyHoldUnknownResult, nativeWheelUnknownResult, publicBrowserReconciliation, textResult, toolDefinition } from './tool-results.js'
import { mcpCapabilityOperationClass } from './capability-classification.js'
import { workspaceIdSchema } from './tool-schemas.js'
import type { McpToolContext, ToolActivityClassification, ToolCallSettlement, ToolOptions, WorkspaceToolCall, WorkspaceToolHandler, WorkspaceToolOptions } from './tools/tool-context.js'
import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'

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

export function requiresWorkspaceWriteLease(toolName: string, input: Record<string, unknown>, exempt: boolean): boolean {
  return mcpCapabilityOperationClass(toolName, input) !== 'read' && !exempt
}

/** What the workspace wrapper uses from the session's MCP server: the tool context plus the server's own call state. */
export type WorkspaceToolScope = Pick<McpToolContext, 'actionTracker' | 'auditAuthorization' | 'auditReceipts' | 'capabilityAuthorizationFingerprint' | 'client' | 'humanReviewSessionBinding' | 'humanWaiting' | 'manager' | 'onTabActivity' | 'requireActiveCapabilityDispatch' | 'requireAgentWorkspace' | 'reviewedActionArguments' | 'tool' | 'workspaceAuthorizationError' | 'workspaceLeases' | 'workspaceToolInputSchemas'> & {
  argumentNormalizers: Map<string, (args: Record<string, unknown>) => Record<string, unknown>>
  frameRequests: AsyncLocalStorage<{ settlement?: ToolCallSettlement }>
  registerToolWithSettlement: (name: string, config: unknown, handler: unknown, options?: ToolOptions<ToolCallSettlement | undefined>) => RegisteredTool
  rememberInputPolicy: (error: unknown) => void
  requireAgentControl: (name: string, input: Record<string, unknown>, tabId?: string) => void
  reviewBinding: (name: string, input: Record<string, unknown>) => HumanWaitingReviewBinding | undefined
  singleTabControlTools: Set<string>
}

/**
 * Builds the wrapper every workspace tool registers through. It admits the call into the caller's own workspace,
 * resolves its tab, holds the write lease, runs the human review and continuity checks, dispatches the handler with
 * the admitted call, re-checks the target afterwards, records the audit receipt and the tab activity, and settles
 * the result through the tool's options and settlement. It never names a tool.
 */
export function createWorkspaceToolRegistrar(scope: WorkspaceToolScope): McpToolContext['registerWorkspaceTool'] {
  const {
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
  } = scope
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
  return registerWorkspaceTool
}
